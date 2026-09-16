import {parseItemCost} from './item-costs.js';
import {norm,now,qty} from './data.js';
import {importPackingList,validatePackingList} from './phase1.js';
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
