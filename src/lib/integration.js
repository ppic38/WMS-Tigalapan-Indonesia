import {parseItemCost} from './item-costs.js';
import {norm,now,qty,newId,SKU_RE} from './data.js';
import {importPackingList,validatePackingList} from './phase1.js';
import {validateLocationMapping} from './locations.js';

// Sinkronisasi Master SKU dari Mini ERP (owner 2026-09-18) -- KEBALIKAN dari resi (Mini ERP ->
// WMS lewat wms_resi_snapshot): di sini WMS menarik daftar SKU + nama item dari RPC
// wms_master_sku_snapshot (migration 0043 di repo Mini ERP) supaya SKU baru/berubah di Master
// Data "SKU (Harga Jual per Item)" Mini ERP otomatis terdaftar juga di Master SKU WMS -- ini
// yang tadinya harus didaftarkan manual satu-satu (lihat findItem(s,sku)?.active di phase1.js,
// pesan "SKU belum ada / tidak aktif di Master SKU" yang memblokir Impor resi ke Receiving).
// Owner (2026-09-18): "auto-terapkan + catatan" -- BUKAN silent (supaya operator gudang tetap
// tahu ada perubahan datang dari Mini ERP, lihat entri s.uploads di bawah, muncul di Master data
// > Impor & riwayat) dan BUKAN perlu-review-manual (supaya SKU baru langsung siap dipakai saat
// resi yang membutuhkannya diproses, tidak perlu 2 langkah manual terpisah tiap kali).
function skuFieldsFromSku(sku){
 const m=sku.match(/^([A-C])(\d{2})-(\d{3})([A-C])(\d)(\d{2})?$/);
 return m?{brand:m[1],category:m[2],color:m[3],sleeve:m[4],size:m[5],note:m[6]||''}:null;
}
export function planMasterSkuSync(s,snapshot){
 if(!snapshot||!Array.isArray(snapshot.rows)||!snapshot.snapshotId)throw Error('Snapshot Master SKU Mini ERP tidak valid.');
 const added=[],updated=[],invalid=[],seen=new Set();
 for(const r of snapshot.rows){
  const sku=norm(r.sku);
  if(!sku||seen.has(sku))continue;seen.add(sku);
  const itemName=String(r.itemName||'').trim();
  if(!SKU_RE.test(sku)){invalid.push({sku,itemName,reason:'Format SKU tidak dikenali WMS'});continue}
  if(!itemName){invalid.push({sku,itemName,reason:'Nama item kosong'});continue}
  const fields=skuFieldsFromSku(sku);
  const existing=s.items.find(i=>i.sku===sku);
  if(!existing)added.push({sku,itemName,fields});
  else if(existing.itemName!==itemName)updated.push({sku,itemName,previousItemName:existing.itemName,fields});
 }
 return {added,updated,invalid,totalIncoming:snapshot.rows.length};
}
export function applyMasterSkuSync(s,snapshot,user){
 const plan=planMasterSkuSync(s,snapshot),changes=[...plan.added,...plan.updated];
 if(!changes.length)return {...plan,applied:false};
 const previous=structuredClone(s.items);
 for(const c of changes){
  const existing=s.items.find(i=>i.sku===c.sku);
  if(existing)existing.itemName=c.itemName;
  else s.items.push({sku:c.sku,itemName:c.itemName,...c.fields,active:true,...validateLocationMapping(s,{})});
 }
 s.uploads.unshift({id:newId(),type:'ITEMS',filename:'Mini ERP / '+snapshot.snapshotId,rowCount:changes.length,uploadedAt:now(),uploadedBy:user||'MINI_ERP_SYNC',status:'COMMITTED',previous});
 s.integration??={};s.integration.lastMasterSkuPull=now();
 return {...plan,applied:true};
}
export function planResiImport(s,snapshot){
 if(!snapshot||!Array.isArray(snapshot.rows)||!snapshot.snapshotId)throw Error('Snapshot Mini ERP tidak valid.');
 const exists=new Set(s.receipts.map(r=>JSON.stringify([norm(r.expedition),norm(r.externalResiNo)])));
 const errors=[];
 for(const receipt of s.receipts){const incoming=snapshot.rows.filter(r=>norm(r.expedition)===norm(receipt.expedition)&&norm(r.externalResiNo)===norm(receipt.externalResiNo));if(!incoming.length)continue;
  const actual=s.kolis.filter(k=>k.internalResiNo===receipt.internalResiNo).flatMap(k=>k.expectedItems.map(l=>JSON.stringify([norm(k.vendorKoliNo||k.koliNo),norm(l.sku),l.poNumber,Number(l.qtyExpected),l.hppMinor??null]))).sort();
  const expected=incoming.map(r=>JSON.stringify([norm(r.vendorKoliNo),norm(r.sku),String(r.poNumber||norm(r.externalResiNo)).trim(),Number(r.qty),parseItemCost(r['hpp/item'])?.hppMinor??null])).sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected)||incoming.some(r=>Number(r.totalKoli)!==receipt.expectedKoli||String(r.vendorName).trim()!==receipt.vendorName))errors.push(`Resi ${receipt.externalResiNo} sudah ada tetapi isi sumber berubah. Periksa perubahan di Mini ERP sebelum melanjutkan.`);
 }
 const rows=snapshot.rows.filter(r=>!exists.has(JSON.stringify([norm(r.expedition),norm(r.externalResiNo)])));
 if(!rows.length)return {rows:[],groups:[],errors,skipped:snapshot.rows.length};
 const validated=validatePackingList(s,rows);return {...validated,errors:[...errors,...validated.errors],skipped:snapshot.rows.length-rows.length};
}
export function applyResiSnapshot(s,snapshot,user){const plan=planResiImport(s,snapshot);if(plan.errors.length)throw Error(plan.errors[0]);let ids=[];if(plan.rows.length){ids=importPackingList(s,plan.rows,'Mini ERP / '+snapshot.snapshotId,user);for(const r of s.receipts.filter(r=>ids.includes(r.internalResiNo)))Object.assign(r,{source:'MINI_ERP',sourceSnapshot:snapshot.snapshotId})}s.integration??={};s.integration.lastResiPull=now();return ids;}
export function applyMokaStock(s,snapshot){
 if(!Number.isFinite(Date.parse(snapshot?.fetchedAt))||!Array.isArray(snapshot.rows)||!s.stores.some(st=>st.storeId===snapshot.storeId))throw Error('Hanya stok cabang yang dipetakan dapat diterapkan. Stok fisik DC tetap berasal dari transaksi WMS.');
 if(Date.parse(s.integration?.mokaSnapshots?.[snapshot.storeId]?.at||'')>Date.parse(snapshot.fetchedAt))throw Error('Snapshot ini lebih lama dari saldo Moka terakhir. Tarik ulang data.');
 const seen=new Set();const changes=snapshot.rows.map(r=>{const sku=norm(r.sku);if(!sku||!s.items.some(i=>i.sku===sku))throw Error('SKU Moka belum dipetakan ke Master WMS: '+(sku||r.variantId));if(seen.has(sku))throw Error('SKU Moka duplikat pada outlet: '+sku);seen.add(sku);return {key:`${snapshot.storeId}_${sku}`,qty:qty(r.qty)}});
 // A partial catalog must never silently clear or omit a branch SKU.
 if(s.items.some(i=>i.active&&!seen.has(i.sku)))throw Error('Snapshot Moka belum mencakup seluruh SKU aktif WMS. Lengkapi pemetaan sebelum memperbarui stok cabang.');
 for(const c of changes)s.oh[c.key]=c.qty;
 s.integration??={};s.integration.mokaSnapshots??={};s.integration.mokaSnapshots[snapshot.storeId]={at:snapshot.fetchedAt,outletId:snapshot.outletId,rows:snapshot.rows};
}
export function recordIntegrationReceipt(s,id,receipt){const q=s.queue.find(q=>q.id===id);if(!q||receipt.id!==id)throw Error('Tanda terima tidak cocok dengan event.');if(q.status==='SYNCED')return;
 if(receipt.status==='APPLIED'&&!receipt.externalId)throw Error('Nomor bukti sistem tujuan belum tersedia.');
 const status={QUEUED:'WAITING_REMOTE',APPLIED:'SYNCED',FAILED:'FAILED',NOT_FOUND:'WAITING_CONFIGURATION'}[receipt.status];if(!status)throw Error('Status tujuan tidak valid.');Object.assign(q,{status,lastCheckedAt:receipt.checkedAt,externalId:receipt.externalId||null,lastError:''});
 const reference=q.payload.reference,related=s.queue.filter(e=>e.payload.reference===reference);
 if(reference&&related.length&&related.every(e=>e.status==='SYNCED'))for(const m of s.movements.filter(m=>m.refDoc===reference))m.syncStatus='SYNCED';
 const order=s.orders.find(o=>o.doNumber===reference);if(order){const transfers=related.filter(e=>e.target==='MOKA'&&e.event==='TRANSFER_STOCK');if(transfers.length&&transfers.every(e=>e.status==='SYNCED'))order.mokaTransferStatus='SYNCED';}
}
