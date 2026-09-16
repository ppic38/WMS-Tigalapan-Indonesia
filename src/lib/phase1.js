import {parseItemCost} from './item-costs.js';
import {shipPackingOrder} from './outbound.js';
import {locationDistance} from './locations.js';
import {qty,norm,findItem,docNo,newId,now,pickedAt,enqueue} from './data.js';
import {scanItem,closeKoli,receiptLines,putaway,pickItem,shortPick,packItem,cancelPick,seal,ship} from './actions.js';
import {checkingQueue,cartNumber,requireFillableCart,readyPutawayCarts,activeCheckingCart,openCheckingCart} from './carts.js';
import {startWork,requireWork,recordWork,finishWork,stopWork} from './productivity.js';
export const packingColumns=['vendorName','shippingDate','externalResiNo','expedition','totalKoli','vendorKoliNo','poNumber','sku','qty','hpp/item'];
export function validatePackingList(s,input){
 const rows=input.map((r,i)=>({...Object.fromEntries(packingColumns.map(k=>[k,String(r[k]??'').trim()])),_row:r._row||i+2,errors:[]})),groups=new Map(),seen=new Set();
 if(!rows.length||rows.length>50000)return {rows,errors:['File harus berisi 1–50.000 baris'],groups:[]};
 for(const r of rows){try{const cost=parseItemCost(r['hpp/item']);r['hpp/item']=cost?.hppPerItem??null;r.itemCost=cost}catch(e){r.errors.push(e.message)}r.externalResiNo=norm(r.externalResiNo);r.vendorKoliNo=norm(r.vendorKoliNo);r.sku=norm(r.sku);r.poNumber=r.poNumber||r.externalResiNo;
  for(const key of ['vendorName','externalResiNo','expedition','vendorKoliNo'])if(!r[key])r.errors.push(`${key} wajib diisi`);
  if(r.shippingDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.shippingDate)||Number.isNaN(Date.parse(r.shippingDate))||new Date(r.shippingDate).toISOString().slice(0,10)!==r.shippingDate))r.errors.push('shippingDate harus tanggal YYYY-MM-DD yang valid');
  try{r.qty=qty(r.qty);if(!r.qty)throw Error();}catch{r.errors.push('qty harus bilangan bulat positif')}
  try{r.totalKoli=qty(r.totalKoli);if(r.totalKoli<1||r.totalKoli>2000)throw Error();}catch{r.errors.push('totalKoli harus 1–2.000')}
  if(!findItem(s,r.sku)?.active)r.errors.push('SKU belum ada / tidak aktif di Master SKU');
  if(s.receipts.some(p=>norm(p.externalResiNo)===r.externalResiNo&&norm(p.expedition)===norm(r.expedition)))r.errors.push('Nomor resi pada ekspedisi ini sudah diimpor');
  const key=JSON.stringify([norm(r.expedition),r.externalResiNo,r.vendorKoliNo,r.sku,r.poNumber]);if(seen.has(key))r.errors.push('Baris SKU + PO dalam koli duplikat');seen.add(key);
  const shipmentKey=JSON.stringify([norm(r.expedition),r.externalResiNo]);if(!groups.has(shipmentKey))groups.set(shipmentKey,[]);groups.get(shipmentKey).push(r);
 }
 for(const group of groups.values()){const first=group[0],count=new Set(group.map(r=>r.vendorKoliNo)).size;for(const r of group){if(['vendorName','shippingDate','externalResiNo','expedition','totalKoli'].some(k=>r[k]!==first[k]))r.errors.push('Data header resi tidak konsisten');if(count!==Number(r.totalKoli))r.errors.push(`Daftar berisi ${count} koli unik, berbeda dari totalKoli ${r.totalKoli}`)}}
 return {rows,groups:[...groups.values()],errors:rows.flatMap(r=>r.errors.map(e=>`Baris ${r._row}: ${e}`))};
}
export function importPackingList(s,input,filename,user){
 const result=validatePackingList(s,input);if(result.errors.length)throw Error(result.errors[0]);const ids=[];
 for(const rows of result.groups){const f=rows[0],id=docNo(s,'RC'),createdAt=now();ids.push(id);
  s.receipts.unshift({internalResiNo:id,vendorName:f.vendorName,shippingDate:f.shippingDate,externalResiNo:f.externalResiNo,expedition:f.expedition,expectedKoli:f.totalKoli,createdAt,receivedAt:null,intakeConfirmedAt:null,status:'AWAITING_KOLI'});
  const codes=[...new Set(rows.map(r=>r.vendorKoliNo))];for(const [index,code] of codes.entries())s.kolis.push({koliNo:docNo(s,'KL',4),vendorKoliNo:code,internalResiNo:id,position:`${index+1}/${codes.length}`,status:'PENDING',arrivedAt:null,expectedItems:rows.filter(r=>r.vendorKoliNo===code).map(r=>({sku:r.sku,poNumber:r.poNumber,qtyExpected:r.qty,hppPerItem:r.itemCost?.hppPerItem??null,hppMinor:r.itemCost?.hppMinor??null})),scannedItems:[]});
  s.receiptItemCosts??=[];
  const costRows=rows.map(r=>({id:newId(),receiptId:id,externalResiNo:f.externalResiNo,expedition:f.expedition,vendorKoliNo:r.vendorKoliNo,koliNo:s.kolis.find(k=>k.internalResiNo===id&&k.vendorKoliNo===r.vendorKoliNo).koliNo,poNumber:r.poNumber,sku:r.sku,qtyDeclared:r.qty,hppPerItem:r.itemCost?.hppPerItem??null,hppMinor:r.itemCost?.hppMinor??null,currency:'IDR',capturedAt:createdAt}));
  s.receiptItemCosts.push(...costRows);
  if(costRows.some(r=>r.hppMinor!==null))enqueue(s,'MOKA','RECEIPT_ITEM_COSTS',{reference:id,externalResiNo:f.externalResiNo,expedition:f.expedition,metadataOnly:true,currency:'IDR',lines:structuredClone(costRows)});
  s.packingLists.push({externalResiNo:f.externalResiNo,expedition:f.expedition,receiptId:id,vendorName:f.vendorName,filename,totalKoli:f.totalKoli,totalQty:rows.reduce((n,r)=>qty(n+r.qty),0),lineCount:rows.length,uploadedAt:createdAt,uploadedBy:user});
 }return ids;
}
export function receiveKoli(s,receiptId,code,user){
 const r=s.receipts.find(r=>r.internalResiNo===receiptId);if(!r||r.intakeConfirmedAt)throw Error('Penerimaan koli sudah selesai atau kiriman tidak ditemukan');requireWork(s,'RECEIVING',receiptId,user);
 const candidates=s.kolis.filter(k=>k.internalResiNo===receiptId&&(k.koliNo===norm(code)||k.vendorKoliNo===norm(code)));if(candidates.length!==1)throw Error('Kode koli tidak cocok atau ambigu untuk kiriman ini');const k=candidates[0];if(k.arrivedAt)throw Error('Koli ini sudah diterima; scan ganda tidak menambah jumlah');
 k.arrivedAt=now();k.arrivedBy=user;r.status='RECEIVING_KOLI';r.receivedAt??=k.arrivedAt;recordWork(s,'RECEIVING',receiptId,user,{qty:1,unit:'koli',lineKeys:k.expectedItems.map(l=>`${k.koliNo}|${l.sku}|${l.poNumber}`)});return k.koliNo;
}
export function confirmKoliIntake(s,receiptId,user){
 const r=s.receipts.find(r=>r.internalResiNo===receiptId),ks=s.kolis.filter(k=>k.internalResiNo===receiptId);if(!r||r.intakeConfirmedAt)throw Error('Penerimaan koli sudah dikonfirmasi');requireWork(s,'RECEIVING',receiptId,user);
 if(!ks.length||ks.length!==r.expectedKoli||ks.some(k=>!k.arrivedAt))throw Error('Terima seluruh koli sesuai resi sebelum melanjutkan pengecekan isi');r.intakeConfirmedAt=now();r.intakeConfirmedBy=user;r.status='READY_TO_CHECK';enqueue(s,'MINI_ERP','KOLI_INTAKE',{reference:receiptId,externalResiNo:r.externalResiNo,expedition:r.expedition,totalKoli:r.expectedKoli,receivedKoli:ks.length,kolis:ks.map(k=>({koliNo:k.koliNo,vendorKoliNo:k.vendorKoliNo,arrivedAt:k.arrivedAt}))});finishWork(s,'RECEIVING',receiptId);
}
export function beginKoliCart(s,id,value,user){
 const k=checkingQueue(s).find(k=>k.koliNo===id);if(!k)throw Error('Koli belum siap diperiksa atau sudah selesai');
 const cartNo=openCheckingCart(s,value||activeCheckingCart(s,user)?.cartNo,user);startWork(s,'CHECKING',id,user);k.checkingCartNo=cartNo;return cartNo;
}
export function checkKoliItem(s,id,sku,po,amount,condition,user,value){
 const cartNo=cartNumber(value||activeCheckingCart(s,user)?.cartNo),k=s.kolis.find(k=>k.koliNo===id);requireFillableCart(s,cartNo);
 if(activeCheckingCart(s,user)?.cartNo!==cartNo)throw Error('Nomor kereta berubah. Pilih kembali kereta sebelum scan SKU');
 requireWork(s,'CHECKING',id,user);const row=scanItem(s,id,sku,po,amount,condition,cartNo);
 k.checkingCartNo=cartNo;recordWork(s,'CHECKING',id,user,{qty:qty(amount),lineKeys:[`${row.sku}|${row.poNumber}`]});
}
export function finishKoliCheck(s,id,reasons,user){requireWork(s,'CHECKING',id,user);closeKoli(s,id,reasons,user);recordWork(s,'CHECKING',id,user,{qty:0,lineKeys:receiptLines(s.kolis.find(k=>k.koliNo===id)).map(l=>`${l.sku}|${l.poNumber}`)});finishWork(s,'CHECKING',id)}
export function putawayItem(s,f,user){requireWork(s,'PUTAWAY','STAGING',user);putaway(s,f,user);recordWork(s,'PUTAWAY','STAGING',user,{qty:qty(f.qty),lineKeys:[`${norm(f.sku)}|${norm(f.from)}|${norm(f.to)}`]})}
export function startCartPutaway(s,value,user){
 requireWork(s,'PUTAWAY','STAGING',user);const cartNo=cartNumber(value);
 if(!readyPutawayCarts(s).some(c=>c.cartNo===cartNo))throw Error('Kereta tidak ada dalam antrean siap putaway. Selesaikan pengecekan dan persetujuan terlebih dahulu');
 s.cartRuns??=[];let run=s.cartRuns.find(r=>r.cartNo===cartNo&&r.status==='ACTIVE');
 if(run&&run.userId!==user)throw Error('Kereta sedang diproses putaway oleh operator lain');
 if(s.cartRuns.some(r=>r.status==='ACTIVE'&&r.userId===user&&r.cartNo!==cartNo))throw Error('Selesaikan kereta putaway aktif sebelum memilih kereta lain');
 if(!run){run={id:newId(),cartNo,status:'ACTIVE',userId:user,createdAt:now()};s.cartRuns.push(run)}return run.id;
}
export function selectCartItem(s,cartNo,code){
 const item=readyPutawayCarts(s).find(c=>c.cartNo===cartNo)?.items.find(r=>r.sku===norm(code));
 if(!item)throw Error('SKU tidak ditemukan atau sudah habis di kereta ini');
 return {...item,from:item.locationCode,expectedQty:item.qty,requestId:newId()};
}
export function putawayFromCart(s,f,user){
 if(!f.requestId)throw Error('Scan ulang SKU sebelum menyimpan');
 if(s.movements.some(m=>m.operationId===f.requestId))throw Error('Scan lokasi ini sudah tersimpan; scan ulang SKU untuk transaksi berikutnya');
 const session=requireWork(s,'PUTAWAY','STAGING',user),cartNo=cartNumber(f.cartNo);
 const run=s.cartRuns?.find(r=>r.id===f.runId&&r.cartNo===cartNo&&r.status==='ACTIVE');
 if(!run)throw Error('Scan nomor kereta terlebih dahulu; sesi kereta mungkin sudah selesai');
 if(run.userId!==user)throw Error('Kereta sedang diproses putaway oleh operator lain');
 const item=selectCartItem(s,cartNo,f.sku);
 if(item.qty!==Number(f.expectedQty))throw Error('Isi kereta berubah. Scan ulang SKU untuk memuat qty terbaru');
 if(norm(f.from)!==item.locationCode)throw Error('Lokasi asal tidak sesuai isi kereta');
 putawayItem(s,{...f,cartNo},user);Object.assign(s.movements.at(-1),{operationId:f.requestId,cartRunId:run.id});
 s.workEvents.at(-1).lineKeys=[`${run.id}|${norm(f.sku)}`];
 if(!readyPutawayCarts(s).some(c=>c.cartNo===cartNo)){run.status='FINISHED';run.finishedAt=now();const cart=s.checkingCarts.find(c=>c.cartNo===cartNo&&c.status==='CLOSED');if(cart){cart.status='FINISHED';cart.finishedAt=run.finishedAt}stopWork(s,session.id,user,true)}
}
export {locationDistance} from './locations.js';
export function batchHolds(s,sku,location,exceptBatch){return (s.pickBatches||[]).filter(b=>b.id!==exceptBatch&&!['FINISHED','CANCELLED'].includes(b.status)).flatMap(b=>b.tasks).filter(t=>t.sku===sku&&t.location===location).reduce((n,t)=>n+Math.max(0,t.qty-t.pickedQty),0)}
export function planPickRoute(s,picks,startLocation,exceptBatch){
 const free=new Map(s.stock.filter(r=>s.locations.some(l=>l.locationCode===r.locationCode&&l.allocatable)).map(r=>[`${r.sku}|${r.locationCode}`,Math.max(0,r.qty-pickedAt(s,r.sku,r.locationCode)-batchHolds(s,r.sku,r.locationCode,exceptBatch))])),tasks=[];
 const stores=[...new Set(picks.map(p=>p.storeId))].sort((a,b)=>(s.stores.find(st=>st.storeId===a)?.priority||0)-(s.stores.find(st=>st.storeId===b)?.priority||0));
 for(const storeId of stores){let position=startLocation;const needs=picks.filter(p=>p.storeId===storeId).flatMap(p=>p.lines.filter(l=>l.qty>l.pickedQty).map(l=>({pickId:p.id,sku:l.sku,remaining:l.qty-l.pickedQty})));
  while(needs.some(n=>n.remaining>0)){const locations=s.locations.filter(l=>l.allocatable&&needs.some(n=>n.remaining>0&&(free.get(`${n.sku}|${l.locationCode}`)||0)>0)).sort((a,b)=>locationDistance(position,a.locationCode)-locationDistance(position,b.locationCode)||a.locationCode.localeCompare(b.locationCode));
   if(!locations.length)throw Error(`Stok lokasi tidak cukup untuk ${storeId}; periksa batch lain atau lakukan short-pick`);const location=locations[0].locationCode;
   for(const n of needs.filter(n=>n.remaining>0)){const key=`${n.sku}|${location}`,amount=Math.min(n.remaining,free.get(key)||0);if(!amount)continue;tasks.push({id:newId(),storeId,pickId:n.pickId,sku:n.sku,location,qty:amount,pickedQty:0,status:'READY'});n.remaining-=amount;free.set(key,free.get(key)-amount)}position=location;
  }
 }return tasks;
}
export function createPickBatch(s,{pickIds,assigneeId,startLocation},user){
 if(!pickIds?.length||new Set(pickIds).size!==pickIds.length)throw Error('Pilih minimal satu picking list tanpa duplikat');if(!s.workers.some(w=>w.id===assigneeId&&w.active))throw Error('Pilih petugas picking aktif');if(!s.locations.some(l=>l.locationCode===startLocation&&l.allocatable))throw Error('Pilih lokasi awal zona A–P');
 const picks=pickIds.map(id=>s.picks.find(p=>p.id===id));if(picks.some(p=>!p||p.batchId||!['READY','PICKING'].includes(p.status)))throw Error('Picking list sudah masuk batch atau selesai');if(picks.some(p=>!s.allocations.some(a=>a.allocationNo===p.allocationNo&&a.status==='CONFIRMED')))throw Error('Alokasi harus terkonfirmasi');
 const tasks=planPickRoute(s,picks,startLocation);if(!tasks.length)throw Error('Tidak ada item tersisa untuk picking');const id=docNo(s,'BT');s.pickBatches.push({id,pickIds:[...pickIds],assigneeId,startLocation,tasks,status:'READY',createdAt:now(),createdBy:user});for(const p of picks)p.batchId=id;return id;
}
function refreshBatch(s,b){if(b.tasks.every(t=>t.pickedQty===t.qty)){b.status='FINISHED';b.finishedAt=now();finishWork(s,'PICKING',b.id)}else b.status='PICKING'}
export function pickBatchItem(s,batchId,taskId,{sku,location,qty:amount},user){
 const b=s.pickBatches.find(b=>b.id===batchId),t=b?.tasks.find(t=>t.id===taskId);if(!b||!t||['FINISHED','CANCELLED'].includes(b.status))throw Error('Tugas batch sudah selesai / tidak ditemukan');if(b.assigneeId!==user)throw Error('Gunakan operator yang ditugaskan ke batch ini');requireWork(s,'PICKING',batchId,user);
 amount=qty(amount);if(t.sku!==norm(sku)||t.location!==norm(location)||!amount||amount>t.qty-t.pickedQty)throw Error('SKU, lokasi, atau jumlah tidak cocok dengan tugas batch');
 pickItem(s,t.pickId,{sku,location,qty:amount,taskId},user);t.pickedQty+=amount;t.status=t.pickedQty===t.qty?'FINISHED':'PICKING';recordWork(s,'PICKING',batchId,user,{qty:amount,lineKeys:[`${t.pickId}|${t.sku}|${t.location}`]});refreshBatch(s,b);
}
export function shortBatchItem(s,batchId,pickId,sku,reason,user){const b=s.pickBatches.find(b=>b.id===batchId);if(!b||b.assigneeId!==user||!b.pickIds.includes(pickId))throw Error('Batch / petugas tidak sesuai');requireWork(s,'PICKING',batchId,user);shortPick(s,pickId,sku,reason,user);for(const t of b.tasks.filter(t=>t.pickId===pickId&&t.sku===sku&&t.qty>t.pickedQty)){t.shortQty=t.qty-t.pickedQty;t.qty=t.pickedQty;t.status='SHORT';t.reason=reason}refreshBatch(s,b)}
export function replanBatch(s,id,user){const b=s.pickBatches.find(b=>b.id===id);if(!b||['FINISHED','CANCELLED'].includes(b.status)||b.assigneeId!==user)throw Error('Batch tidak dapat disusun ulang');const tasks=planPickRoute(s,b.pickIds.map(id=>s.picks.find(p=>p.id===id)),b.startLocation,b.id);b.tasks=[...b.tasks.filter(t=>t.pickedQty>0||t.shortQty).map(t=>({...t,qty:t.pickedQty,status:'FINISHED'})),...tasks];b.replannedAt=now()}
export function cancelBatch(s,id,reason,user){const b=s.pickBatches.find(b=>b.id===id);if(!b||['FINISHED','CANCELLED'].includes(b.status))throw Error('Batch sudah selesai');if(b.pickIds.some(id=>s.picks.find(p=>p.id===id)?.lines.some(l=>l.packedQty>0)))throw Error('Batch memiliki item yang sudah dipacking');for(const id of b.pickIds)cancelPick(s,id,reason,user);b.status='CANCELLED';finishWork(s,'PICKING',id)}
export function packFinishedItem(s,id,sku,amount,user){requireWork(s,'PACKING',id,user);packItem(s,id,sku,amount);recordWork(s,'PACKING',id,user,{qty:qty(amount),lineKeys:[norm(sku)]})}

export function sealPacking(s,id,user){requireWork(s,'PACKING',id,user);seal(s,id);finishWork(s,'PACKING',id)}

export function shipWithWork(s,id,user){requireWork(s,'SHIPPING','DISPATCH',user);const order=s.orders.find(o=>o.doNumber===norm(id));if(order?.outboundVersion===2)shipPackingOrder(s,id,user);else ship(s,id,user);recordWork(s,'SHIPPING','DISPATCH',user,{qty:order.lines.reduce((n,l)=>n+l.qty,0),lineKeys:order.lines.map(l=>`${order.doNumber}|${l.sku}`)})}
