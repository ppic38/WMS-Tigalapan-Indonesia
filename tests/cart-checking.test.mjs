import {seed} from './mapped-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMutation,physical} from '../src/lib/data.js';
import {checkingQueue,putawaySources,cartStagingRows,closeCheckingCart} from '../src/lib/carts.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,putawayItem} from '../src/lib/phase1.js';
import {startWork,stopWork,productivity} from '../src/lib/productivity.js';
import {receiptLines,approve,scanItem} from '../src/lib/actions.js';

const user='OP-IN-01';
function shipment(s,id,items,receive=true){
 const rows=items.map(([sku,qty])=>({packingListNo:id,vendorName:'Vendor '+id,externalResiNo:id,expedition:'Uji',totalKoli:1,vendorKoliNo:'VENDOR-K01',poNumber:'PO-'+id,sku,qty}));
 const receiptId=importPackingList(s,rows,'test.csv',user)[0];
 const k=s.kolis.find(k=>k.internalResiNo===receiptId);
 if(receive){startWork(s,'RECEIVING',receiptId,user);receiveKoli(s,receiptId,k.koliNo,user);confirmKoliIntake(s,receiptId,user)}
 return k;
}
function rejected(s,fn,pattern){const before=structuredClone(s);assert.throws(()=>applyMutation(s,fn),pattern);assert.deepEqual(s,before)}

test('The checking queue combines received shipments and identifies repeated vendor koli numbers by WMS ID',()=>{
 const s=seed(),sku=s.items[0].sku;
 const a=shipment(s,'PL-A',[[sku,2]]),b=shipment(s,'PL-B',[[sku,2]]),c=shipment(s,'PL-C',[[sku,2]],false);
 assert.notEqual(a.koliNo,b.koliNo);assert.equal(a.vendorKoliNo,b.vendorKoliNo);
 assert.deepEqual(checkingQueue(s).map(k=>k.koliNo),[a.koliNo,b.koliNo]);
 beginKoliCart(s,b.koliNo,'KRT-2',user);checkKoliItem(s,b.koliNo,sku,'',1,'GOOD',user,'KRT-2');
 assert.equal(checkingQueue(s).find(k=>k.koliNo===b.koliNo).status,'CHECKING');
 checkKoliItem(s,b.koliNo,sku,'',1,'GOOD',user,'KRT-2');finishKoliCheck(s,b.koliNo,{},user);
 assert.deepEqual(checkingQueue(s).map(k=>k.koliNo),[a.koliNo]);
 rejected(s,d=>beginKoliCart(d,c.koliNo,'KRT-1',user),/belum siap/);
 rejected(s,d=>beginKoliCart(d,b.koliNo,'KRT-1',user),/sudah selesai/);
});

test('Multiple SKUs and split quantities retain their cart through checking, partial putaway and stock movements',()=>{
 const s=seed();s.stock=[];const [a,b]=s.items.map(i=>i.sku),k=shipment(s,'PL-A',[[a,8],[b,4]]);
 beginKoliCart(s,k.koliNo,' krt-01 ',user);
 checkKoliItem(s,k.koliNo,a,'',1,'GOOD',user,'KRT-01');checkKoliItem(s,k.koliNo,a,'',2,'GOOD',user,'KRT-01');checkKoliItem(s,k.koliNo,b,'',4,'GOOD',user,'KRT-01');
 closeCheckingCart(s,'KRT-01',user);beginKoliCart(s,k.koliNo,'KRT-02',user);checkKoliItem(s,k.koliNo,a,'',5,'GOOD',user,'KRT-02');
 assert.equal(k.scannedItems.length,3);assert.deepEqual(k.scannedItems.map(r=>[r.cartNo,r.qtyScanned]),[['KRT-01',3],['KRT-01',4],['KRT-02',5]]);
 assert.deepEqual(receiptLines(k).map(l=>[l.received,l.variance]),[[8,0],[4,0]]);
 assert.deepEqual(putawaySources(s),[]);assert.equal(s.stock.length,0);
 rejected(s,d=>checkKoliItem(d,k.koliNo,a,'',1,'GOOD',user,'KRT-01'),/kereta berubah|sudah close/);
 finishKoliCheck(s,k.koliNo,{},user);assert.equal(putawaySources(s).reduce((n,r)=>n+r.qty,0),12);
 const metric=productivity(s,{end:Date.now()+1000}).people.find(r=>r.process==='CHECKING');assert.equal(metric.qty,12);assert.equal(metric.lines,2);
 startWork(s,'PUTAWAY','STAGING',user);
 const f={sku:a,cartNo:'KRT-01',from:'S01-1-01',to:'A01-1-01',qty:2};
 rejected(s,d=>putawayItem(d,{...f,qty:4},user),/isi kereta/);
 rejected(s,d=>putawayItem(d,{...f,cartNo:''},user),/Pilih nomor kereta/);
 rejected(s,d=>putawayItem(d,{...f,cartNo:'OTHER'},user),/isi kereta/);
 putawayItem(s,f,user);assert.equal(putawaySources(s).find(r=>r.cartNo==='KRT-01'&&r.sku===a).qty,1);
 putawayItem(s,{...f,cartNo:'KRT-02',qty:5},user);putawayItem(s,{...f,qty:1},user);putawayItem(s,{...f,sku:b,qty:4},user);
 assert.deepEqual(putawaySources(s),[]);assert.equal(physical(s,a),8);assert.equal(physical(s,b),4);
 assert.equal(s.stock.filter(r=>r.locationCode[0]==='S').reduce((n,r)=>n+r.qty,0),0);
 assert.deepEqual(s.movements.filter(r=>r.type==='PUTAWAY').map(r=>r.cartNo),['KRT-01','KRT-02','KRT-01','KRT-01']);
 assert(s.queue.filter(q=>q.event==='PUTAWAY').every(q=>q.payload.cartNo));
 rejected(s,d=>putawayItem(d,f,user),/isi kereta/);
});

test('Blank or invalid carts and rejected scans do not change quantities or work records',()=>{
 const s=seed(),sku=s.items[0].sku,k=shipment(s,'PL-A',[[sku,2]]);
 for(const value of ['', '  ','A'.repeat(41),'<script>'])rejected(s,d=>beginKoliCart(d,k.koliNo,value,user),/kereta/);
 rejected(s,d=>checkKoliItem(d,k.koliNo,sku,'',1,'GOOD',user),/kereta wajib/);
 beginKoliCart(s,k.koliNo,'KRT-01',user);
 rejected(s,d=>checkKoliItem(d,k.koliNo,'UNKNOWN','',1,'GOOD',user,'KRT-01'),/SKU tidak dikenal/);
 rejected(s,d=>checkKoliItem(d,k.koliNo,sku,'',1.5,'GOOD',user,'KRT-01'),/bilangan bulat/);
 stopWork(s,s.workSessions.find(w=>w.status==='RUNNING').id,user);
 rejected(s,d=>checkKoliItem(d,k.koliNo,sku,'',1,'GOOD',user,'KRT-01'),/Mulai kerja/);
 assert.equal(k.scannedItems.length,0);
});

test('A shared cart includes only closed good lines; quarantine quantities wait for approval',()=>{
 const s=seed();s.stock=[];const [a,b]=s.items.map(i=>i.sku),k=shipment(s,'PL-A',[[a,4]]),other=shipment(s,'PL-B',[[b,3]]);
 beginKoliCart(s,k.koliNo,'KRT-01',user);checkKoliItem(s,k.koliNo,a,'',3,'GOOD',user,'KRT-01');checkKoliItem(s,k.koliNo,a,'',1,'DAMAGED',user,'KRT-01');
 finishKoliCheck(s,k.koliNo,{[`${a}|PO-PL-A`]:'DAMAGED_IN_TRANSIT'},user);
 assert.equal(cartStagingRows(s).length,0);
 beginKoliCart(s,other.koliNo,'KRT-01',user);checkKoliItem(s,other.koliNo,b,'',3,'GOOD',user,'KRT-01');
 const approval=s.approvals[0];approve(s,approval.id,'SPV',true,'Diperiksa',user);assert.equal(cartStagingRows(s).length,0);approve(s,approval.id,'MANAGER',true,'Diterima sesuai fisik',user);
 assert.deepEqual(putawaySources(s).map(r=>[r.sku,r.qty]),[[a,3]]);
 finishKoliCheck(s,other.koliNo,{},user);assert.deepEqual(putawaySources(s).map(r=>[r.cartNo,r.sku,r.qty]),[['KRT-01',a,3],['KRT-01',b,3]]);
 startWork(s,'PUTAWAY','STAGING',user);putawayItem(s,{sku:a,cartNo:'KRT-01',from:'S01-1-01',to:'A01-1-01',qty:3},user);
 assert.equal(s.stock.find(r=>r.sku===a&&r.locationCode==='R01-1-01').qty,1);
});

test('Existing scans without a cart remain intact and are distinguishable from newly carted items',()=>{
 const s=seed();s.stock=[];const sku=s.items[0].sku,k=shipment(s,'PL-A',[[sku,5]]);
 scanItem(s,k.koliNo,sku,'',2,'GOOD');const old=structuredClone(k.scannedItems[0]);
 beginKoliCart(s,k.koliNo,'KRT-01',user);checkKoliItem(s,k.koliNo,sku,'',3,'GOOD',user,'KRT-01');finishKoliCheck(s,k.koliNo,{},user);
 assert.deepEqual(k.scannedItems[0],old);assert.deepEqual(putawaySources(s).map(r=>[r.cartNo,r.qty]),[['KRT-01',3],['',2]]);
 startWork(s,'PUTAWAY','STAGING',user);putawayItem(s,{sku,cartNo:'',from:'S01-1-01',to:'A01-1-01',qty:2},user);
 assert.equal(cartStagingRows(s)[0].qty,3);assert.equal(k.scannedItems[0].cartNo,undefined);
});
