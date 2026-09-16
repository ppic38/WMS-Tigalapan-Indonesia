import {norm,qty,newId,docNo,now,pickedAt,audit,move,enqueue} from './data.js';
import {cartNumber,cartBalance} from './carts.js';
import {isStorageLocation,locationDistance} from './locations.js';
import {currentWarehouseLayout,storageRacks,rackPoint,layoutIssues} from './warehouse-layout.js';
import {startWork,requireWork,recordWork,finishWork} from './productivity.js';

const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]||0),0);
const activeBatch=b=>!['FINISHED','CANCELLED'].includes(b.status);
const total=b=>sum(b.tasks,'qty');
function worker(s,user){if(!s.workers.some(w=>w.id===user&&w.active))throw Error('Pilih operator aktif');}
function positive(value,label='Qty'){const n=qty(value);if(n<1)throw Error(`${label} minimal 1 pcs`);return n;}
function reasonText(value){const text=String(value||'').trim();if(!text)throw Error('Alasan wajib diisi');return text;}
function ensure(s){s.cartMasters??=[];s.pickingCartRuns??=[];s.packingKolis??=[];}
export function outboundCartQty(s,runId){return (s.pickBatches||[]).filter(b=>b.cartRunId===runId&&b.status!=='CANCELLED').reduce((n,b)=>n+b.tasks.reduce((a,t)=>a+t.pickedQty-(t.packedQty||0),0),0);}
export function activePickingCart(s,user){return s.pickingCartRuns?.find(c=>c.ownerId===user&&c.status==='OPEN');}
export function pickingCartInfo(s,c){const used=outboundCartQty(s,c.id),reserved=(s.pickBatches||[]).filter(b=>b.cartRunId===c.id&&activeBatch(b)).reduce((n,b)=>n+total(b)-sum(b.tasks,'pickedQty'),0);return {...c,used,reserved,free:Math.max(0,c.capacity-used-reserved)};}
export function scanPickingCart(s,value,user,capacity){
 ensure(s);worker(s,user);const cartNo=cartNumber(value),current=activePickingCart(s,user);
 if(current&&current.cartNo!==cartNo)throw Error('Lepas kereta aktif sebelum scan kereta baru');
 if(s.checkingCarts?.some(c=>c.cartNo===cartNo&&c.status!=='FINISHED')||cartBalance(s,cartNo).qty>0||s.cartRuns?.some(c=>c.cartNo===cartNo&&c.status==='ACTIVE'))throw Error('Kereta masih digunakan Receiving / Putaway');
 const run=s.pickingCartRuns.find(c=>c.cartNo===cartNo&&c.status!=='FINISHED');
 if(run&&(run.ownerId!==user||run.status!=='OPEN'))throw Error('Kereta sedang digunakan operator lain atau menunggu packing');
 let master=s.cartMasters.find(c=>c.cartNo===cartNo);
 const limit=capacity!==undefined?positive(capacity,'Kapasitas kereta'):master?.capacity;
 if(!limit)throw Error('Kereta belum terdaftar. Isi kapasitas kereta dalam pcs.');
 if(run&&run.capacity!==limit)throw Error('Kapasitas tidak dapat diubah saat kereta digunakan');
 if(run)return run.id;
 if(!master){master={cartNo,capacity:limit};s.cartMasters.push(master)}else master.capacity=limit;
 const next={id:newId(),cartNo,capacity:limit,ownerId:user,status:'OPEN',storeId:null,openedAt:now()};s.pickingCartRuns.push(next);return next.id;
}
export function releasePickingCart(s,user){
 const c=activePickingCart(s,user);if(!c)throw Error('Scan kereta terlebih dahulu');
 if(s.pickBatches.some(b=>b.cartRunId===c.id&&activeBatch(b)))throw Error('Selesaikan batch aktif sebelum melepas kereta');
 c.status=outboundCartQty(s,c.id)>0?'CLOSED':'FINISHED';c.closedAt=now();if(c.status==='FINISHED')c.finishedAt=c.closedAt;
}
function freeCart(s,c){if(c&&outboundCartQty(s,c.id)===0&&!s.pickBatches.some(b=>b.cartRunId===c.id&&activeBatch(b))){c.status='FINISHED';c.finishedAt=now();}}
export function plannedQty(s,pickId,sku){return (s.pickBatches||[]).filter(activeBatch).flatMap(b=>b.tasks).filter(t=>t.pickId===pickId&&t.sku===sku).reduce((n,t)=>n+Math.max(0,t.qty-t.pickedQty),0);}
export function batchCandidates(s){return s.picks.filter(p=>(!p.batchId||p.outboundVersion===2)&&(!p.lines.some(l=>l.pickedQty>0)||p.outboundVersion===2)&&!['CANCELLED','SHIPPED','PACKED'].includes(p.status)&&p.lines.some(l=>l.qty-l.pickedQty-plannedQty(s,p.id,l.sku)>0));}
export function routingDistance(s){
 const layout=currentWarehouseLayout(s),catalog=storageRacks(s);
 if(!layout.configured||layout.unplaced.length||layoutIssues(layout,catalog.map(r=>r.id)).length)return {mode:'kode lokasi',distance:locationDistance};
 const point=code=>{const r=layout.racks.find(r=>r.id===code.slice(0,3)),c=catalog.find(r=>r.id===code.slice(0,3));if(!r||!c)return null;return rackPoint(r,[(c.bins.indexOf(code.slice(-2))+.5)*r.width/c.bins.length,r.depth]);};
 return {mode:'denah tersimpan',distance:(a,b)=>{const x=point(a),y=point(b);return x&&y?Math.abs(x[0]-y[0])+Math.abs(x[1]-y[1])+Math.abs(Number(a[4])-Number(b[4]))*.01:locationDistance(a,b);}};
}
function heldAt(s,sku,location,exceptBatch){return s.pickBatches.filter(b=>b.id!==exceptBatch&&activeBatch(b)).flatMap(b=>b.tasks).filter(t=>t.sku===sku&&t.location===location).reduce((n,t)=>n+Math.max(0,t.qty-t.pickedQty),0);}
function routeNeeds(s,input,startLocation,exceptBatch){
 const needs=input.map(n=>({...n})),free=new Map(),tasks=[],route=routingDistance(s);let position=startLocation;
 for(const l of s.locations.filter(isStorageLocation))for(const n of needs){const key=`${n.sku}|${l.locationCode}`;free.set(key,Math.max(0,s.stock.filter(r=>r.sku===n.sku&&r.locationCode===l.locationCode).reduce((n,r)=>n+r.qty,0)-pickedAt(s,n.sku,l.locationCode)-heldAt(s,n.sku,l.locationCode,exceptBatch)));}
 while(needs.some(n=>n.remaining>0)){
  const locations=s.locations.filter(l=>isStorageLocation(l)&&needs.some(n=>n.remaining>0&&(free.get(`${n.sku}|${l.locationCode}`)||0)>0)).sort((a,b)=>route.distance(position,a.locationCode)-route.distance(position,b.locationCode)||a.locationCode.localeCompare(b.locationCode));
  if(!locations.length)throw Error('Stok lokasi tidak cukup untuk sisa batch. Periksa stok atau lakukan short-pick.');
  const location=locations[0].locationCode;
  for(const n of needs){const key=`${n.sku}|${location}`,amount=Math.min(n.remaining,free.get(key)||0);if(!amount)continue;tasks.push({id:newId(),pickId:n.pickId,storeId:n.storeId,sku:n.sku,location,qty:amount,pickedQty:0,packedQty:0,shippedQty:0,status:'READY'});n.remaining-=amount;free.set(key,free.get(key)-amount);}
  position=location;
 }
 return tasks;
}
export function previewCapacityBatches(s,{pickIds,capacity,startLocation}){
 const limit=positive(capacity,'Kapasitas kereta');
 if(!pickIds?.length||new Set(pickIds).size!==pickIds.length)throw Error('Pilih picking list tanpa duplikat');
 if(!s.locations.some(l=>l.locationCode===startLocation&&isStorageLocation(l)))throw Error('Pilih lokasi awal penyimpanan aktif');
 const picks=pickIds.map(id=>s.picks.find(p=>p.id===id));
 if(picks.some(p=>!p||['CANCELLED','SHIPPED','PACKED'].includes(p.status)||!s.allocations.some(a=>a.allocationNo===p.allocationNo&&a.status==='CONFIRMED')))throw Error('Picking list / alokasi sudah berubah');
 const stores=[...new Set(picks.map(p=>p.storeId))].sort((a,b)=>(s.stores.find(st=>st.storeId===a)?.priority||0)-(s.stores.find(st=>st.storeId===b)?.priority||0)||a.localeCompare(b)),batches=[],temp=structuredClone(s);
 for(const storeId of stores){
  const needs=picks.filter(p=>p.storeId===storeId).flatMap(p=>p.lines.map(l=>({pickId:p.id,storeId,sku:l.sku,remaining:Math.max(0,l.qty-l.pickedQty-plannedQty(s,p.id,l.sku))}))).filter(n=>n.remaining>0);
  if(!needs.length)continue;
  const tasks=routeNeeds(temp,needs,startLocation);let group=null;
  for(const t of tasks){let remaining=t.qty;while(remaining>0){if(!group||total(group)===limit){group={storeId,capacity:limit,startLocation,tasks:[],status:'READY'};batches.push(group)}const take=Math.min(remaining,limit-total(group));group.tasks.push({...t,id:newId(),qty:take});remaining-=take;}}
  temp.pickBatches.push({id:newId(),status:'READY',tasks});
 }
 if(!batches.length)throw Error('Semua qty telah masuk batch atau sudah diambil');
 return batches;
}
export function createCapacityBatches(s,input,user){
 worker(s,user);const groups=previewCapacityBatches(s,input),ids=[];
 for(const group of groups){const id=docNo(s,'BT');ids.push(id);const pickIds=[...new Set(group.tasks.map(t=>t.pickId))];s.pickBatches.push({...group,id,pickIds,version:2,assigneeId:null,cartRunId:null,cartNo:null,createdAt:now(),createdBy:user,routeMode:routingDistance(s).mode});for(const pickId of pickIds){const p=s.picks.find(p=>p.id===pickId);p.outboundVersion=2;p.batchIds=[...new Set([...(p.batchIds||[]),id])];}}
 return ids;
}
export function splitReadyBatch(s,id,capacity,user){
 worker(s,user);const b=s.pickBatches.find(b=>b.id===id&&b.version===2),limit=positive(capacity,'Kapasitas kereta');
 if(!b||b.status!=='READY'||b.assigneeId||b.tasks.some(t=>t.pickedQty>0))throw Error('Hanya batch yang belum diambil operator yang dapat dipecah');
 if(total(b)<=limit)throw Error('Batch sudah sesuai kapasitas');
 const groups=[];let group;
 for(const t of b.tasks){let remaining=t.qty;while(remaining){if(!group||total(group)===limit){group={tasks:[]};groups.push(group)}const take=Math.min(remaining,limit-total(group));group.tasks.push({...t,id:newId(),qty:take});remaining-=take;}}
 const ids=[];for(const group of groups){const nextId=docNo(s,'BT'),pickIds=[...new Set(group.tasks.map(t=>t.pickId))];ids.push(nextId);s.pickBatches.push({...b,...group,id:nextId,pickIds,capacity:limit,parentBatchId:b.id,createdAt:now(),createdBy:user});for(const pickId of pickIds){const p=s.picks.find(p=>p.id===pickId);p.batchIds=[...new Set([...(p.batchIds||[]),nextId])];}}
 b.status='CANCELLED';b.cancelReason=`Dipecah ke ${ids.join(', ')}`;b.finishedAt=now();return ids;
}
export function claimPickBatch(s,id,user){
 worker(s,user);const b=s.pickBatches.find(b=>b.id===id&&b.version===2),c=activePickingCart(s,user);
 if(!c)throw Error('Scan kereta sebelum mengambil batch');
 if(!b||!activeBatch(b))throw Error('Batch sudah selesai / tidak tersedia');
 if(b.assigneeId&&b.assigneeId!==user)throw Error('Batch sudah diambil operator lain');
 if(b.cartRunId&&b.cartRunId!==c.id)throw Error('Batch terikat ke kereta lain');
 if(s.pickBatches.some(other=>other.id!==id&&activeBatch(other)&&(other.assigneeId===user||other.cartRunId===c.id)))throw Error('Selesaikan batch aktif terlebih dahulu');
 if(c.storeId&&c.storeId!==b.storeId)throw Error('Satu kereta hanya boleh berisi satu tujuan store. Lepas kereta ini dahulu.');
 if(!b.cartRunId&&total(b)>pickingCartInfo(s,c).free)throw Error('Kapasitas kereta tidak cukup untuk batch ini');
 startWork(s,'PICKING',id,user);Object.assign(b,{assigneeId:user,cartRunId:c.id,cartNo:c.cartNo,status:'PICKING',startedAt:b.startedAt||now()});c.storeId=b.storeId;return id;
}
function batchContext(s,id,user){const b=s.pickBatches.find(b=>b.id===id&&b.version===2),c=activePickingCart(s,user);if(!b||!activeBatch(b)||b.assigneeId!==user||!c||c.id!==b.cartRunId)throw Error('Scan kereta dan ambil batch yang ditugaskan ke operator ini');requireWork(s,'PICKING',id,user);return {b,c};}
function refreshPick(p){if(p.lines.every(l=>(l.shippedQty||0)===l.qty)&&p.lines.some(l=>l.qty>0))p.status='SHIPPED';else if(p.lines.every(l=>l.packedQty===l.qty)&&p.lines.some(l=>l.qty>0))p.status='PACKED';else if(p.lines.every(l=>l.pickedQty===l.qty))p.status=p.lines.some(l=>l.qty>0)?'PICKED':'CANCELLED';else p.status=p.lines.some(l=>l.pickedQty>0)?'PICKING':'READY';}
function finishBatch(s,b,c){if(b.tasks.every(t=>t.pickedQty===t.qty)){b.status='FINISHED';b.finishedAt=now();finishWork(s,'PICKING',b.id);freeCart(s,c);}}
export function pickCartBatchItem(s,id,taskId,f,user){
 const {b,c}=batchContext(s,id,user),t=b.tasks.find(t=>t.qty>t.pickedQty),amount=positive(f.qty);
 if(!f.requestId||s.movements.some(m=>m.operationId===f.requestId))throw Error('Scan ini sudah tersimpan atau tidak valid. Scan ulang SKU.');
 if(!t||t.id!==taskId||t.sku!==norm(f.sku)||t.location!==norm(f.location)||amount>t.qty-t.pickedQty)throw Error('Lokasi, SKU, atau qty tidak sesuai tugas berikutnya');
 if(cartNumber(f.cartNo)!==c.cartNo)throw Error('Nomor kereta tidak sesuai batch');
 const p=s.picks.find(p=>p.id===t.pickId),line=p?.lines.find(l=>l.sku===t.sku),physical=sum(s.stock.filter(r=>r.sku===t.sku&&r.locationCode===t.location),'qty');
 if(!p||!line||!s.allocations.some(a=>a.allocationNo===p.allocationNo&&a.status==='CONFIRMED')||line.pickedQty+amount>line.qty)throw Error('Alokasi atau picking list telah berubah');
 if(!s.locations.some(l=>l.locationCode===t.location&&isStorageLocation(l)))throw Error('Lokasi tugas tidak aktif. Susun ulang rute.');
 const others=s.pickBatches.filter(activeBatch).flatMap(b=>b.tasks).filter(other=>other.id!==t.id&&other.sku===t.sku&&other.location===t.location).reduce((n,t)=>n+t.qty-t.pickedQty,0);
 if(amount>physical-pickedAt(s,t.sku,t.location)-others)throw Error('Stok sudah diambil atau dijadwalkan batch lain');
 if(outboundCartQty(s,c.id)+amount>c.capacity)throw Error('Kapasitas kereta terlampaui');
 line.pickedQty+=amount;line.pickingStatus=line.pickedQty===line.qty?'PICKING_FINISH':'PICKING';line.sources.push({id:newId(),location:t.location,qty:amount,shippedQty:0,batchId:id,taskId:t.id,cartNo:c.cartNo,cartRunId:c.id});
 t.pickedQty+=amount;t.status=t.pickedQty===t.qty?'FINISHED':'PICKING';refreshPick(p);
 audit(s,{type:'PICK',sku:t.sku,qty:amount,fromLocation:t.location,toLocation:c.cartNo,cartNo:c.cartNo,cartRunId:c.id,batchId:id,operationId:f.requestId,refDoc:t.pickId,userId:user});
 recordWork(s,'PICKING',id,user,{qty:amount,lineKeys:[`${t.pickId}|${t.sku}|${t.location}`]});finishBatch(s,b,c);
}
export function shortCartBatchTask(s,id,taskId,reason,user){
 reason=reasonText(reason);const {b,c}=batchContext(s,id,user),t=b.tasks.find(t=>t.id===taskId&&t.qty>t.pickedQty);if(!t)throw Error('Tugas tidak memiliki sisa picking');
 const p=s.picks.find(p=>p.id===t.pickId),l=p.lines.find(l=>l.sku===t.sku),a=s.allocations.find(a=>a.allocationNo===p.allocationNo),al=a.lines.find(l=>l.sku===t.sku&&l.storeId===p.storeId),amount=t.qty-t.pickedQty;
 l.qty-=amount;l.pickingStatus=l.qty===l.pickedQty?'PICKING_FINISH':'PICKING';al.allocatedQty-=amount;t.shortQty=(t.shortQty||0)+amount;t.qty=t.pickedQty;t.status='SHORT';t.reason=reason;
 audit(s,{type:'RESERVE',sku:t.sku,qty:amount,fromLocation:'V01-1-01',toLocation:'GENERAL',refDoc:id,userId:user});
 s.counts.push({id:docNo(s,'CC'),sku:t.sku,locationCode:t.location,status:'PRIORITY',reason,createdAt:now()});refreshPick(p);finishBatch(s,b,c);
}
export function replanCartBatch(s,id,user){
 const {b}=batchContext(s,id,user),needs=b.tasks.filter(t=>t.qty>t.pickedQty).map(t=>({pickId:t.pickId,storeId:t.storeId,sku:t.sku,remaining:t.qty-t.pickedQty}));
 const tasks=routeNeeds(s,needs,b.tasks.filter(t=>t.pickedQty>0).at(-1)?.location||b.startLocation,b.id);
 b.tasks=[...b.tasks.filter(t=>t.pickedQty>0||t.shortQty).map(t=>({...t,qty:t.pickedQty,status:t.shortQty?'SHORT':'FINISHED'})),...tasks];b.replannedAt=now();
}
export function cancelCapacityBatch(s,id,reason,user){
 reason=reasonText(reason);const b=s.pickBatches.find(b=>b.id===id&&b.version===2);worker(s,user);
 if(!b||!activeBatch(b))throw Error('Batch sudah selesai');if(b.assigneeId&&b.assigneeId!==user)throw Error('Batch milik operator lain');
 if(b.tasks.some(t=>t.packedQty>0||t.shippedQty>0))throw Error('Barang sudah dipacking / dikirim');
 for(const t of b.tasks){const p=s.picks.find(p=>p.id===t.pickId),l=p.lines.find(l=>l.sku===t.sku);l.pickedQty-=t.pickedQty;l.sources=l.sources.filter(x=>x.taskId!==t.id);if(t.pickedQty)audit(s,{type:'PICK_RETURN',sku:t.sku,qty:t.pickedQty,fromLocation:b.cartNo,toLocation:t.location,refDoc:id,userId:user});l.pickingStatus=l.pickedQty===l.qty?'PICKING_FINISH':l.pickedQty?'PICKING':'READY';refreshPick(p);}
 b.status='CANCELLED';b.cancelReason=reason;b.finishedAt=now();finishWork(s,'PICKING',id);freeCart(s,s.pickingCartRuns.find(c=>c.id===b.cartRunId));
}

export function packingCartRows(s,{storeId,cartNo,sku}={}){
 return (s.pickBatches||[]).filter(b=>b.version===2&&b.status==='FINISHED'&&(!storeId||b.storeId===storeId)&&(!cartNo||b.cartNo===norm(cartNo))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).flatMap(b=>b.tasks.filter(t=>t.pickedQty>(t.packedQty||0)&&(!sku||t.sku===norm(sku))).map(t=>({...t,batchId:b.id,cartNo:b.cartNo,cartRunId:b.cartRunId,remaining:t.pickedQty-(t.packedQty||0)})));
}
export function openPackingKoli(s,value,storeId,user){
 ensure(s);worker(s,user);const koliNo=cartNumber(value);
 const existing=s.packingKolis.find(k=>k.koliNo===koliNo);
 if(existing){if(existing.status!=='OPEN'||existing.ownerId!==user)throw Error('Nomor koli sudah disegel atau sedang dikerjakan operator lain');if(existing.storeId!==storeId)throw Error('Store tidak sesuai nomor koli');startWork(s,'PACKING',koliNo,user);return koliNo;}
 if(s.packingKolis.some(k=>k.ownerId===user&&k.status==='OPEN'))throw Error('Selesaikan koli aktif sebelum membuat koli baru');
 if(!s.stores.some(st=>st.storeId===storeId&&st.active)||!packingCartRows(s,{storeId}).length)throw Error('Pilih store dengan batch picking finish');
 startWork(s,'PACKING',koliNo,user);s.packingKolis.push({koliNo,storeId,ownerId:user,status:'OPEN',createdAt:now(),lines:[]});return koliNo;
}
export function packCartIntoKoli(s,f,user){
 const k=s.packingKolis?.find(k=>k.koliNo===norm(f.koliNo)&&k.status==='OPEN');if(!k||k.ownerId!==user)throw Error('Buka koli packing milik operator ini terlebih dahulu');
 requireWork(s,'PACKING',k.koliNo,user);const amount=positive(f.qty),cartNo=cartNumber(f.cartNo),sku=norm(f.sku);
 if(!f.requestId||s.movements.some(m=>m.operationId===f.requestId))throw Error('Scan packing sudah tersimpan atau tidak valid. Scan ulang SKU.');
 const rows=packingCartRows(s,{storeId:k.storeId,cartNo,sku});
 if(amount>sum(rows,'remaining'))throw Error('Qty melebihi isi kereta dengan batch picking finish untuk store ini');
 let remaining=amount;
 for(const row of rows){if(!remaining)break;const take=Math.min(row.remaining,remaining),b=s.pickBatches.find(b=>b.id===row.batchId),t=b.tasks.find(t=>t.id===row.id),p=s.picks.find(p=>p.id===t.pickId),l=p.lines.find(l=>l.sku===sku);
  t.packedQty=(t.packedQty||0)+take;l.packedQty+=take;refreshPick(p);
  let line=k.lines.find(l=>l.taskId===t.id);if(!line){line={taskId:t.id,batchId:b.id,pickId:p.id,sku,location:t.location,cartNo,cartRunId:b.cartRunId,qty:0};k.lines.push(line)}line.qty+=take;remaining-=take;
 }
 audit(s,{type:'PACK',sku,qty:amount,fromLocation:cartNo,toLocation:k.koliNo,cartNo,refDoc:k.koliNo,userId:user,operationId:f.requestId});recordWork(s,'PACKING',k.koliNo,user,{qty:amount,lineKeys:[sku]});
 for(const c of s.pickingCartRuns.filter(c=>c.cartNo===cartNo&&c.status!=='FINISHED'))freeCart(s,c);
}
export function sealPackingKoli(s,value,user){
 const k=s.packingKolis?.find(k=>k.koliNo===norm(value));if(!k||k.status!=='OPEN'||k.ownerId!==user)throw Error('Koli sudah disegel atau milik operator lain');requireWork(s,'PACKING',k.koliNo,user);
 if(!k.lines.length||!sum(k.lines,'qty'))throw Error('Koli kosong tidak dapat disegel');
 const id=docNo(s,'DO');s.orders.unshift({doNumber:id,outboundVersion:2,koliNo:k.koliNo,storeId:k.storeId,pickingListIds:[...new Set(k.lines.map(l=>l.pickId))],batchIds:[...new Set(k.lines.map(l=>l.batchId))],status:'READY',createdAt:now(),lines:k.lines.map(l=>({...l,sources:[{location:l.location,qty:l.qty}]})),mokaTransferStatus:'NOT_SENT'});
 k.status='SEALED';k.sealedAt=now();k.doNumber=id;finishWork(s,'PACKING',k.koliNo);return id;
}
export function cancelEmptyPackingKoli(s,value,user){const k=s.packingKolis?.find(k=>k.koliNo===norm(value));if(!k||k.status!=='OPEN'||k.ownerId!==user||k.lines.length)throw Error('Hanya koli kosong milik operator ini yang dapat dibatalkan');k.status='CANCELLED';k.cancelledAt=now();finishWork(s,'PACKING',k.koliNo);}
export function shipPackingOrder(s,value,user){
 requireWork(s,'SHIPPING','DISPATCH',user);
 const id=norm(value),o=s.orders.find(o=>o.doNumber===id&&o.outboundVersion===2),k=s.packingKolis?.find(k=>k.koliNo===o?.koliNo);
 if(!o||o.status!=='READY'||k?.status!=='SEALED')throw Error('Surat jalan sudah dikirim atau koli belum disegel');
 const need=new Map();
 for(const l of o.lines){const p=s.picks.find(p=>p.id===l.pickId),line=p?.lines.find(x=>x.sku===l.sku),b=s.pickBatches.find(b=>b.id===l.batchId),task=b?.tasks.find(t=>t.id===l.taskId),a=s.allocations.find(a=>a.allocationNo===p?.allocationNo);
  if(!line||!task||a?.status!=='CONFIRMED'||p.storeId!==o.storeId||b.status!=='FINISHED'||l.qty<1||(task.shippedQty||0)+l.qty>(task.packedQty||0)||sum(line.sources.filter(x=>x.taskId===task.id),'qty')-sum(line.sources.filter(x=>x.taskId===task.id),'shippedQty')<l.qty)throw Error('Jejak batch, alokasi, atau qty koli tidak cocok');
  const key=`${l.sku}|${l.location}`;need.set(key,(need.get(key)||0)+l.qty);
 }
 for(const [key,n] of need){const [sku,location]=key.split('|');if(sum(s.stock.filter(r=>r.sku===sku&&r.locationCode===location),'qty')<n)throw Error(`Stok ${sku} di ${location} tidak cukup untuk pengiriman`);}
 for(const l of o.lines){const p=s.picks.find(p=>p.id===l.pickId),line=p.lines.find(x=>x.sku===l.sku),a=s.allocations.find(a=>a.allocationNo===p.allocationNo),al=a.lines.find(x=>x.storeId===p.storeId&&x.sku===l.sku),task=s.pickBatches.find(b=>b.id===l.batchId).tasks.find(t=>t.id===l.taskId);
  move(s,l.sku,l.qty,l.location,null,'SHIP',id,user);Object.assign(s.movements.at(-1),{koliNo:k.koliNo,batchId:l.batchId,cartNo:l.cartNo});
  let remaining=l.qty;for(const source of line.sources.filter(x=>x.taskId===l.taskId)){const n=Math.min(remaining,source.qty-(source.shippedQty||0));source.shippedQty=(source.shippedQty||0)+n;remaining-=n;}
  task.shippedQty=(task.shippedQty||0)+l.qty;line.shippedQty=(line.shippedQty||0)+l.qty;al.shippedQty=(al.shippedQty||0)+l.qty;refreshPick(p);
  s.od[`${p.storeId}_${l.sku}`]=qty((s.od[`${p.storeId}_${l.sku}`]||0)+l.qty);enqueue(s,'MOKA','TRANSFER_STOCK',{fromOutlet:'DC',toOutlet:p.storeId,sku:l.sku,qty:l.qty,reference:id,koliNo:k.koliNo,batchId:l.batchId});
 }
 enqueue(s,'MINI_ERP','SHIPPING',{reference:id,storeId:o.storeId,koliNo:k.koliNo,batchIds:o.batchIds,lines:o.lines});o.status='SHIPPED';o.shippedAt=now();o.mokaTransferStatus='WAITING_CONFIGURATION';k.status='SHIPPED';k.shippedAt=o.shippedAt;
}
