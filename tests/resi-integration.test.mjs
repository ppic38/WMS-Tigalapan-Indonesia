import test from 'node:test';import assert from 'node:assert/strict';
import {seed,applyMutation,migrateState} from '../src/lib/data.js';
import {packingColumns,importPackingList,validatePackingList} from '../src/lib/phase1.js';
import {applyResiSnapshot,planResiImport,applyMokaStock,recordIntegrationReceipt,planMasterSkuSync,applyMasterSkuSync} from '../src/lib/integration.js';
import {createIntegrationGateway} from '../server/integration-gateway.js';
const manifest=s=>s.items.slice(0,2).map((i,n)=>({externalResiNo:'RESI-NEW',vendorName:'Vendor',expedition:'Courier',totalKoli:2,vendorKoliNo:'K'+n,sku:i.sku,qty:10}));
test('Receiving needs resi only; duplicate shipment identity is normalized and previous data survives migration',()=>{
 const s=seed();const before=structuredClone(s),rows=manifest(s);assert(!packingColumns.includes('packingListNo'));assert.equal(validatePackingList(s,rows).errors.length,0);const [id]=importPackingList(s,rows,'resi.csv','TEST');assert.equal(s.receipts[0].externalResiNo,'RESI-NEW');assert.equal(s.kolis.find(k=>k.internalResiNo===id).expectedItems[0].poNumber,'RESI-NEW');assert(!('packingListNo'in s.receipts[0]));
 assert(validatePackingList(s,rows.map(r=>({...r,externalResiNo:' resi-new ',expedition:'courier'}))).errors.some(e=>e.includes('sudah diimpor')));
 assert(validatePackingList(s,rows.map(r=>({...r,externalResiNo:''}))).errors.some(e=>e.includes('externalResiNo')));
 assert.equal(validatePackingList(s,rows.map(r=>({...r,expedition:'Another courier'}))).errors.length,0);
 const restored=migrateState(structuredClone(s));assert.deepEqual(restored.receipts,s.receipts);assert.deepEqual(restored.stock,before.stock);
});
test('ERP pull is idempotent, never overwrites a changed existing resi and rolls back unknown SKU imports',()=>{
 let s=seed();const snapshot={snapshotId:'erp-1',rows:manifest(s)};s=applyMutation(s,d=>applyResiSnapshot(d,snapshot,'TEST'));const count=s.receipts.length;const same=applyMutation(s,d=>applyResiSnapshot(d,snapshot,'TEST'));assert.equal(same.receipts.length,count);assert.equal(planResiImport(s,snapshot).rows.length,0);
 const changed=structuredClone(snapshot);changed.rows[0].qty++;assert.throws(()=>applyMutation(s,d=>applyResiSnapshot(d,changed,'TEST')),/berubah/);
 const bad=manifest(s).map(r=>({...r,externalResiNo:'RESI-BAD',sku:'UNKNOWN'}));assert.throws(()=>applyMutation(s,d=>applyResiSnapshot(d,{snapshotId:'bad',rows:bad},'TEST')),/SKU/);assert.equal(s.receipts.length,count);
});
test('Master SKU sync from Mini ERP adds new SKUs, renames changed ones, skips invalid rows, preserves mapping, and is idempotent',()=>{
 const s=seed();const existing=s.items.find(i=>i.sku==='B01-097A5');
 const snapshot={snapshotId:'sku-1',rows:[
  {sku:existing.sku,itemName:existing.itemName+' (revisi)'},
  {sku:'B01-052A5',itemName:'Kaos Polos 24S · Sky Blue XL'},
  {sku:'INVALID-SKU',itemName:'Format tidak dikenal'},
  {sku:'B01-060A5',itemName:''},
 ],totalIncoming:4};
 const plan=planMasterSkuSync(s,snapshot);
 assert.equal(plan.added.length,1);assert.equal(plan.added[0].sku,'B01-052A5');
 assert.equal(plan.updated.length,1);assert.equal(plan.updated[0].sku,existing.sku);
 assert.equal(plan.invalid.length,2);
 const next=applyMutation(s,d=>applyMasterSkuSync(d,snapshot,'MINI_ERP_SYNC'));
 assert.equal(next.items.find(i=>i.sku===existing.sku).itemName,existing.itemName+' (revisi)');
 const added=next.items.find(i=>i.sku==='B01-052A5');assert(added);assert.equal(added.active,true);assert.equal(added.brand,'B');assert.equal(added.category,'01');assert.equal(added.color,'052');assert.equal(added.sleeve,'A');assert.equal(added.size,'5');assert.equal(added.primaryLocation,'');
 assert(!next.items.some(i=>i.sku==='INVALID-SKU'||i.sku==='B01-060A5'));
 assert.equal(next.uploads[0].type,'ITEMS');assert.equal(next.uploads[0].rowCount,2);assert.equal(next.uploads[0].uploadedBy,'MINI_ERP_SYNC');assert.equal(next.uploads[0].status,'COMMITTED');
 const again=applyMutation(next,d=>applyMasterSkuSync(d,snapshot,'MINI_ERP_SYNC'));
 assert.equal(again.uploads.length,next.uploads.length);assert.equal(again.items.length,next.items.length);
 assert.throws(()=>planMasterSkuSync(s,{rows:[]}),/tidak valid/);
});
test('Moka branch snapshot changes OH only, rejects gaps, duplicates, unknown or fractional qty atomically',()=>{
 const s=seed(),original=structuredClone(s),snapshot={storeId:s.stores[0].storeId,outletId:'42',fetchedAt:new Date().toISOString(),rows:s.items.map((item,i)=>({sku:item.sku,variantId:String(i),qty:11}))};
 const next=applyMutation(s,d=>applyMokaStock(d,snapshot));assert.equal(next.oh[`${snapshot.storeId}_${s.items[0].sku}`],11);assert.deepEqual(next.stock,original.stock);assert.deepEqual(next.queue,original.queue);
 for(const bad of [{...snapshot,storeId:'DC'},{...snapshot,rows:snapshot.rows.slice(1)},{...snapshot,rows:[...snapshot.rows,snapshot.rows[0]]},{...snapshot,rows:snapshot.rows.map(r=>({...r,qty:.5}))}])assert.throws(()=>applyMutation(s,d=>applyMokaStock(d,bad)));
 assert.deepEqual(s,original);
});
test('QUEUED is not synced; valid applied evidence synchronizes movements only after all destinations acknowledge',()=>{
 const s=seed();s.movements=[{refDoc:'PA1',syncStatus:'PENDING'}];s.queue=['MINI_ERP','MOKA'].map((target,i)=>({id:'event'+i,target,event:'PUTAWAY',payload:{reference:'PA1'},status:'WAITING_CONFIGURATION'}));
 recordIntegrationReceipt(s,'event0',{id:'event0',status:'QUEUED'});assert.equal(s.queue[0].status,'WAITING_REMOTE');assert.equal(s.movements[0].syncStatus,'PENDING');assert.throws(()=>recordIntegrationReceipt(s,'event0',{id:'event0',status:'APPLIED'}),/bukti/);
 recordIntegrationReceipt(s,'event0',{id:'event0',status:'APPLIED',externalId:'ERP-42'});assert.equal(s.movements[0].syncStatus,'PENDING');recordIntegrationReceipt(s,'event1',{id:'event1',status:'APPLIED',externalId:'MOKA-42'});assert.equal(s.movements[0].syncStatus,'SYNCED');
});
const env={WMS_INTEGRATION_ENABLED:'true',SUPABASE_URL:'https://testproject.supabase.co',SUPABASE_ANON_KEY:'sb_anon_fixture',SUPABASE_SERVER_KEY:'sb_secret_fixture',MINI_ERP_RESI_RPC:'read_resi',MINI_ERP_MASTER_SKU_RPC:'read_master_sku',WMS_OUTBOX_RPC:'wms_integration_event',MOKA_ACCESS_TOKEN:'fixture-token',MOKA_OUTLET_MAP:'{"ST01":"42"}',WMS_ALLOW_EVENT_SUBMIT:'true'};
const req=(path,body)=>new Request('https://wms.test/api/integrations/'+path,body?{method:'POST',body:JSON.stringify(body)}:{});const json=data=>new Response(JSON.stringify(data));
test('Gateway keeps secrets server-only, requires complete ERP snapshots and maps paginated Moka variants',async()=>{
 const calls=[];const gateway=createIntegrationGateway(async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('read_resi'))return json({snapshotId:'r1',totalRows:1,truncated:false,rows:[{externalResiNo:'R',sku:'B01-097A3'}]});const page=new URL(url).searchParams.get('page');return json({meta:{code:200},data:{total_pages:2,items:[{id:Number(page),name:'Item',item_variants:[{id:Number(page),sku:'SKU'+page,in_stock:3,track_stock:true}]}]}})});
 const status=await (await gateway(req('status'),env)).text();assert(!status.includes('fixture'));assert.equal((await gateway(req('resi'),env)).status,200);assert.equal(calls[0].options.headers.apikey,'sb_anon_fixture');assert.equal(calls[0].options.headers.Authorization,'Bearer sb_secret_fixture');
 const response=await (await gateway(req('moka-stock?storeId=ST01'),env)).json();assert.equal(response.rows.length,2);assert.equal(calls[1].options.headers.Authorization,'Bearer fixture-token');assert.equal((await gateway(req('moka-stock?storeId=BAD'),env)).status,400);
 const partial=createIntegrationGateway(async()=>json({snapshotId:'r',rows:[],truncated:true,totalRows:10}));assert.equal((await partial(req('resi'),env)).status,502);
});
test('Gateway serves Master SKU snapshot only when configured and enforces the same completeness contract as resi',async()=>{
 const gateway=createIntegrationGateway(async url=>{assert(String(url).includes('read_master_sku'));return json({snapshotId:'sku-1',totalRows:1,truncated:false,rows:[{sku:'B01-097A3',itemName:'Kaos Polos 24S · Abu Sedang'}]})});
 const response=await (await gateway(req('master-sku'),env)).json();assert.equal(response.snapshotId,'sku-1');assert.deepEqual(response.rows,[{sku:'B01-097A3',itemName:'Kaos Polos 24S · Abu Sedang'}]);
 assert.equal((await gateway(req('master-sku'),{...env,MINI_ERP_MASTER_SKU_RPC:''})).status,503);
 const partial=createIntegrationGateway(async()=>json({snapshotId:'s',rows:[],truncated:true,totalRows:5}));assert.equal((await partial(req('master-sku'),env)).status,502);
});
test('Gateway refuses disabled writes, untrusted Supabase hosts, false acknowledgements and external redirects',async()=>{
 let calls=0;const gateway=createIntegrationGateway(async()=>{calls++;return json({id:'wrong',status:'APPLIED',externalId:'1'})});const event={id:'e1',target:'MOKA',event:'PUTAWAY',payload:{reference:'R',qty:1}};
 assert.equal((await gateway(req('outbox',{action:'submit',event}),{...env,WMS_ALLOW_EVENT_SUBMIT:'false'})).status,503);assert.equal(calls,0);
 assert.equal((await gateway(req('resi'),{...env,SUPABASE_URL:'https://other.test'})).status,502);assert.equal(calls,0);
 assert.equal((await gateway(req('outbox',{action:'submit',event}),env)).status,502);
 const redirected=createIntegrationGateway(async(url,options)=>{assert.equal(options.redirect,'error');throw Error('redirect')});assert.equal((await redirected(req('resi'),env)).status,502);
});
