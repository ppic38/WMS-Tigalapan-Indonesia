import {norm,newId,now} from './data.js';

export function checkingQueue(s){
 const confirmed=new Set(s.receipts.filter(r=>r.intakeConfirmedAt).map(r=>r.internalResiNo));
 return s.kolis.filter(k=>k.arrivedAt&&confirmed.has(k.internalResiNo)&&['PENDING','CHECKING'].includes(k.status));
}

export function cartNumber(value){
 const code=norm(value).replace(/\s+/g,' ');
 if(!code)throw Error('Nomor kereta wajib diisi sebelum scan SKU');
 if(!/^[A-Z0-9][A-Z0-9 _./-]{0,39}$/.test(code))throw Error('Nomor kereta maksimal 40 karakter: huruf, angka, spasi, titik, garis miring atau tanda hubung');
 return code;
}

export function migrateCartLifecycle(s){
 s.checkingCarts??=[];if(s.cartLifecycleVersion===1)return s;
 const codes=new Set(s.kolis.flatMap(k=>[...k.scannedItems.filter(r=>r.cartNo&&r.condition==='GOOD'&&r.qtyScanned>(r.putawayQty||0)).map(r=>r.cartNo),...(['PENDING','CHECKING'].includes(k.status)&&k.checkingCartNo?[k.checkingCartNo]:[])]));
 for(const cartNo of codes)if(!s.checkingCarts.some(c=>c.cartNo===cartNo&&c.status!=='FINISHED')){
  const run=s.cartRuns?.find(r=>r.cartNo===cartNo&&r.status==='ACTIVE');
  s.checkingCarts.push({id:newId(),cartNo,userId:null,status:run?'CLOSED':'OPEN',openedAt:now(),closedAt:run?.createdAt||null,migrated:true});
 }
 s.cartLifecycleVersion=1;return s;
}
export function activeCheckingCart(s,user){return s.checkingCarts?.find(c=>c.userId===user&&c.status==='OPEN')}
export function cartBalance(s,cartNo){
 const rows=s.kolis.flatMap(k=>k.scannedItems.filter(r=>r.cartNo===cartNo&&r.condition==='GOOD'&&r.qtyScanned>(r.putawayQty||0)).map(r=>({...r,koliNo:k.koliNo,qty:r.qtyScanned-(r.putawayQty||0)})));
 return {qty:rows.reduce((n,r)=>n+r.qty,0),skuCount:new Set(rows.map(r=>r.sku)).size,koliCount:new Set(rows.map(r=>r.koliNo)).size};
}
export function requireFillableCart(s,cartNo){
 if(s.pickingCartRuns?.some(c=>c.cartNo===cartNo&&c.status!=='FINISHED'))throw Error('Kereta masih digunakan Picking / Packing');
 if(s.checkingCarts?.some(c=>c.cartNo===cartNo&&c.status==='CLOSED')||(s.cartRuns||[]).some(r=>r.cartNo===cartNo&&r.status==='ACTIVE'))throw Error('Kereta sudah close atau masih dalam proses putaway. Selesaikan seluruh isinya sebelum dipakai kembali');
}
export function openCheckingCart(s,value,user){
 const cartNo=cartNumber(value);requireFillableCart(s,cartNo);
 if(!s.workers.some(w=>w.id===user&&w.active))throw Error('Pilih operator aktif');
 const current=activeCheckingCart(s,user);if(current&&current.cartNo!==cartNo)throw Error('Close kereta aktif sebelum menggunakan kereta baru');
 let cart=s.checkingCarts.find(c=>c.cartNo===cartNo&&c.status==='OPEN');
 if(cart?.userId&&cart.userId!==user)throw Error('Kereta sedang diisi operator lain');
 if(!cart){cart={id:newId(),cartNo,userId:user,status:'OPEN',openedAt:now()};s.checkingCarts.push(cart)}else cart.userId=user;
 return cartNo;
}
export function closeCheckingCart(s,value,user){
 const cartNo=cartNumber(value),cart=s.checkingCarts.find(c=>c.cartNo===cartNo&&c.status==='OPEN');
 if(!cart)throw Error('Kereta sudah close atau tidak ditemukan');
 if(cart.userId&&cart.userId!==user)throw Error('Kereta sedang diisi operator lain');
 cart.closedItems=s.kolis.flatMap(k=>k.scannedItems.filter(r=>r.cartNo===cartNo&&r.condition==='GOOD'&&r.qtyScanned>(r.putawayQty||0)).map(r=>({koliNo:k.vendorKoliNo||k.koliNo,sku:r.sku,poNumber:r.poNumber,qty:r.qtyScanned-(r.putawayQty||0)})));
 const balance=cartBalance(s,cartNo);Object.assign(cart,{status:balance.qty?'CLOSED':'FINISHED',closedAt:now(),closedBy:user,closedQty:balance.qty,closedSkuCount:balance.skuCount,closedKoliCount:balance.koliCount});
 if(!balance.qty)cart.finishedAt=cart.closedAt;return cartNo;
}
export function closedCartQueue(s){
 const ready=readyPutawayCarts(s);
 return (s.checkingCarts||[]).filter(c=>c.status==='CLOSED').map(c=>({...c,...cartBalance(s,c.cartNo),ready:ready.some(r=>r.cartNo===c.cartNo)})).filter(c=>c.qty>0);
}

export function readyPutawayCarts(s){
 const held=new Set();
 for(const k of s.kolis)for(const row of k.scannedItems){
  if(!row.cartNo||row.condition!=='GOOD'||row.qtyScanned<=(row.putawayQty||0))continue;
  const line=k.closedLines?.find(l=>l.sku===row.sku&&l.poNumber===row.poNumber);
  if(!k.closedAt||!line||line.discrepancy&&k.status!=='CLOSED')held.add(row.cartNo);
 }
 const groups=new Map();
 for(const row of putawaySources(s).filter(r=>r.cartNo&&!held.has(r.cartNo)&&s.checkingCarts?.some(c=>c.cartNo===r.cartNo&&c.status==='CLOSED'))){
  if(!groups.has(row.cartNo))groups.set(row.cartNo,{cartNo:row.cartNo,items:[],qty:0});
  const cart=groups.get(row.cartNo);cart.items.push(row);cart.qty+=row.qty;
 }
 return [...groups.values()].sort((a,b)=>a.cartNo.localeCompare(b.cartNo));
}

// Cart balances are part of the existing staging stock, never additional stock.
// Older scans without a cart stay unassigned; their history is not rewritten.
export function cartStagingRows(s){
 return s.kolis.flatMap(k=>{
  if(!k.closedAt||!['CLOSED','DISCREPANCY'].includes(k.status))return [];
  return k.scannedItems.flatMap(row=>{
   const line=k.closedLines?.find(l=>l.sku===row.sku&&l.poNumber===row.poNumber);
   const remaining=row.qtyScanned-(row.putawayQty||0);
   if(!row.cartNo||row.condition!=='GOOD'||!line||remaining<=0||line.discrepancy&&k.status!=='CLOSED')return [];
   return [{koliNo:k.koliNo,cartNo:row.cartNo,sku:row.sku,locationCode:'S01-1-01',qty:remaining,row}];
  });
 });
}

export function putawaySources(s){
 const groups=new Map();
 for(const r of cartStagingRows(s)){
  const key=JSON.stringify([r.cartNo,r.sku,r.locationCode]);
  if(!groups.has(key))groups.set(key,{key,cartNo:r.cartNo,sku:r.sku,locationCode:r.locationCode,qty:0});
  groups.get(key).qty+=r.qty;
 }
 const rows=[...groups.values()];
 for(const stock of s.stock.filter(r=>r.locationCode[0]==='S'&&r.qty>0)){
  const assigned=rows.filter(r=>r.sku===stock.sku&&r.locationCode===stock.locationCode).reduce((n,r)=>n+r.qty,0);
  if(stock.qty>assigned)rows.push({...stock,qty:stock.qty-assigned,cartNo:'',key:JSON.stringify(['',stock.sku,stock.locationCode])});
 }
 return rows;
}

export function planCartPutaway(s,sku,from,cartNo,amount){
 const rows=cartStagingRows(s).filter(r=>r.sku===sku&&r.locationCode===from);
 if(!cartNo){
  const stock=s.stock.find(r=>r.sku===sku&&r.locationCode===from)?.qty||0;
  if(amount>stock-rows.reduce((n,r)=>n+r.qty,0)&&rows.length)throw Error('Jumlah melebihi stok tanpa kereta. Pilih nomor kereta asal SKU ini');
  return [];
 }
 const candidates=rows.filter(r=>r.cartNo===cartNo);
 if(amount>candidates.reduce((n,r)=>n+r.qty,0))throw Error('Qty melebihi isi kereta yang siap putaway; periksa nomor kereta, SKU, dan status pengecekan');
 let remaining=amount;
 return candidates.flatMap(r=>{const take=Math.min(remaining,r.qty);remaining-=take;return take?[{row:r.row,qty:take}]:[]});
}
