// Credentials and endpoint names are supplied only by the server administrator.
const columns=['externalResiNo','vendorName','shippingDate','expedition','totalKoli','vendorKoliNo','poNumber','sku','qty','hpp/item'];
const events={MINI_ERP:['RECEIVING','KOLI_INTAKE','PUTAWAY','SHIPPING'],MOKA:['RECEIPT_ITEM_COSTS','PUTAWAY','STOCK_ADJUSTMENT','RETURN_SELLABLE','TRANSFER_STOCK']};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const configured=env=>({enabled:env.WMS_INTEGRATION_ENABLED==='true',miniErp:!!(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVER_KEY&&env.MINI_ERP_RESI_RPC),outbox:!!(env.SUPABASE_URL&&env.SUPABASE_ANON_KEY&&env.SUPABASE_SERVER_KEY&&env.WMS_OUTBOX_RPC),moka:!!(env.MOKA_ACCESS_TOKEN&&env.MOKA_OUTLET_MAP)});
function outlets(env){let value;try{value=JSON.parse(env.MOKA_OUTLET_MAP||'{}')}catch{throw Error('Pemetaan outlet Moka di server tidak valid.')}
 if(!value||Array.isArray(value)||Object.values(value).some(v=>!/^\d+$/.test(String(v)))||new Set(Object.values(value).map(String)).size!==Object.keys(value).length)throw Error('Pemetaan outlet Moka harus unik dan berupa ID angka.');return value;}
async function boundedJSON(response){const reader=response.body?.getReader();let size=0;const chunks=[];if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw Error('Data terlalu besar. Persempit data pada konektor sumber.')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error('Respons sistem tujuan bukan JSON yang valid.')}}
export function createIntegrationGateway(fetcher=fetch){
 async function request(url,options){let response;try{response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)})}catch{throw Error('Koneksi terputus atau waktu tunggu habis. Untuk pengiriman, periksa status event sebelum mencoba ulang.')}
 if(!response.ok)throw Error(`Sistem tujuan menolak permintaan (HTTP ${response.status}). Periksa konfigurasi dan izin konektor.`);
 const body=await boundedJSON(response);if(body.meta?.code&&body.meta.code!==200)throw Error(`Moka menolak permintaan (${body.meta.code}).`);return body;}
 // 2 kredensial TERPISAH & dua-duanya wajib (owner Mini ERP, 2026-09-16): `apikey` HARUS key
 // project yang terdaftar (anon) supaya API Gateway Supabase menerima request sama sekali --
 // Gateway itu SEKARANG menolak sembarang JWT bertanda tangan valid sebagai `apikey` (beda dari
 // versi Supabase lama yang jadi asumsi awal kode ini). `Authorization: Bearer` membawa
 // SUPABASE_SERVER_KEY -- token custom-role (BUKAN service_role Mini ERP) yang PostgREST pakai
 // untuk menentukan role eksekusi sesungguhnya (`wms_integration_role`, cuma boleh EXECUTE 2 RPC
 // ini, tidak ada akses tabel apa pun -- lihat integration/README.md & migration Mini ERP terkait).
 async function rpc(env,name,payload){
  const url=new URL(env.SUPABASE_URL);if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.port)throw Error('Gunakan URL project Supabase HTTPS yang valid.');
  if(!env.SUPABASE_ANON_KEY)throw Error('SUPABASE_ANON_KEY belum dikonfigurasi.');
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(name||''))throw Error('Nama RPC integrasi belum dikonfigurasi.');
  return request(new URL('/rest/v1/rpc/'+name,url),{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+env.SUPABASE_SERVER_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 }
 return async function handle(requestIn,env){
  const url=new URL(requestIn.url),path=url.pathname,config=configured(env);
  try{
   if(path==='/api/integrations/status'&&requestIn.method==='GET')return reply({...config,outlets:Object.entries(outlets(env)).map(([storeId,outletId])=>({storeId,outletId:String(outletId)})),mode:'SERVER_CONNECTORS',sharedWarehouseStock:false});
   if(!config.enabled)return reply({error:'Koneksi belum diaktifkan. Lengkapi konfigurasi server dan pemetaan Mini ERP/Moka terlebih dahulu.'},503);
   if(path==='/api/integrations/resi'&&requestIn.method==='GET'){
    if(!config.miniErp)return reply({error:'Koneksi resi Mini ERP belum dikonfigurasi.'},503);
    const data=await rpc(env,env.MINI_ERP_RESI_RPC,{p_limit:50000});
    if(!Array.isArray(data.rows)||!data.snapshotId||data.truncated!==false||data.totalRows!==data.rows.length||data.rows.length>50000)throw Error('Snapshot resi harus lengkap: rows, snapshotId, totalRows dan truncated=false. Tidak ada data diimpor.');
    return reply({snapshotId:String(data.snapshotId),rows:data.rows.map(r=>Object.fromEntries(columns.map(k=>[k,r[k]??'']))),fetchedAt:new Date().toISOString()});
   }
   if(path==='/api/integrations/moka-stock'&&requestIn.method==='GET'){
    if(!config.moka)return reply({error:'Token dan pemetaan outlet Moka belum dikonfigurasi.'},503);
    const storeId=url.searchParams.get('storeId'),outletId=outlets(env)[storeId];if(!outletId)return reply({error:'Cabang belum dipetakan ke outlet Moka.'},400);
    const rows=[];let totalPages=1;
    for(let page=1;page<=totalPages;page++){
     const data=await request(`https://api.mokapos.com/v1/outlets/${outletId}/items?page=${page}&per_page=100&include_deleted=false`,{headers:{Authorization:'Bearer '+env.MOKA_ACCESS_TOKEN,'Content-Type':'application/json'}});
     const items=data.data?.items??data.data?.item;if(!Array.isArray(items)||!Number.isInteger(data.data?.total_pages)||data.data.total_pages<0||data.data.total_pages>500)throw Error('Daftar stok Moka tidak lengkap atau format pagination berubah.');
     if(page>1&&totalPages!==data.data.total_pages)throw Error('Jumlah halaman Moka berubah saat penarikan. Tarik ulang snapshot.');totalPages=data.data.total_pages;
     for(const item of items.filter(i=>!i.is_deleted))for(const variant of item.item_variants||[])if(!variant.is_deleted&&variant.track_stock===true)rows.push({sku:String(variant.sku||'').trim().toUpperCase(),itemId:String(item.id),variantId:String(variant.id),qty:variant.in_stock,itemName:item.name});
    }
    return reply({storeId,outletId:String(outletId),rows,fetchedAt:new Date().toISOString()});
   }
   if(path==='/api/integrations/outbox'&&requestIn.method==='POST'){
    if(!config.outbox)return reply({error:'Outbox persisten Supabase belum dikonfigurasi. Event tetap tersimpan di perangkat.'},503);
    const input=await boundedJSON(requestIn),event=input.event;
    if(!['submit','status'].includes(input.action)||!event||!/^[a-zA-Z0-9_-]{1,100}$/.test(event.id)||!events[event.target]?.includes(event.event)||!event.payload||typeof event.payload!=='object')return reply({error:'Event integrasi tidak valid.'},400);
    if(input.action==='submit'&&env.WMS_ALLOW_EVENT_SUBMIT!=='true')return reply({error:'Pengiriman belum diaktifkan. Kontrak outbox dan pemetaan tujuan harus diverifikasi.'},503);
    const receipt=await rpc(env,env.WMS_OUTBOX_RPC,{p_action:input.action,p_event:{id:event.id,target:event.target,event:event.event,payload:event.payload,createdAt:event.createdAt}});
    if(receipt.id!==event.id||!['QUEUED','APPLIED','FAILED','NOT_FOUND'].includes(receipt.status)||(receipt.status==='APPLIED'&&!receipt.externalId))throw Error('Tanda terima tujuan belum valid. Periksa status event; jangan menganggap tersinkron.');
    return reply({id:receipt.id,status:receipt.status,externalId:receipt.externalId?String(receipt.externalId):null,checkedAt:new Date().toISOString()});
   }
   return reply({error:'Endpoint atau metode tidak tersedia.'},404);
  }catch(error){return reply({error:error.message},502)}
 };
}
