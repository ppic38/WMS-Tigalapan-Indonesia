import {seed} from './mapped-fixture.mjs';
import {processHistory} from '../src/lib/reports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMutation,migrateState} from '../src/lib/data.js';
import {openCheckingCart,activeCheckingCart,closeCheckingCart,readyPutawayCarts,closedCartQueue,cartBalance} from '../src/lib/carts.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,startCartPutaway,selectCartItem,putawayFromCart} from '../src/lib/phase1.js';
import {startWork} from '../src/lib/productivity.js';
import {approve} from '../src/lib/actions.js';
const user='OP-IN-01';
function prepare(){const s=seed();s.stock=[];const a=s.items[0].sku,b=s.items[1].sku;const common={packingListNo:'MULTI-KOLI',vendorName:'Vendor',externalResiNo:'R',expedition:'E',totalKoli:2,poNumber:'PO'};const id=importPackingList(s,[{...common,vendorKoliNo:'K1',sku:a,qty:5},{...common,vendorKoliNo:'K2',sku:a,qty:3},{...common,vendorKoliNo:'K2',sku:b,qty:2}],'multi.csv',user)[0];startWork(s,'RECEIVING',id,user);const ks=s.kolis.filter(k=>k.internalResiNo===id);for(const k of ks)receiveKoli(s,id,k.koliNo,user);confirmKoliIntake(s,id,user);return {s,a,b,ks}}
function reject(s,fn,re){const old=structuredClone(s);assert.throws(()=>applyMutation(s,fn),re);assert.deepEqual(s,old)}
test('One cart entry persists across koli and reload; closed cart combines quantities and cannot accept new scans',()=>{
 let {s,a,b,ks}=prepare();openCheckingCart(s,' KRT-ONE ',user);
 startWork(s,'CHECKING',ks[0].koliNo,user);checkKoliItem(s,ks[0].koliNo,a,'PO',5,'GOOD',user);finishKoliCheck(s,ks[0].koliNo,{},user);
 assert.equal(readyPutawayCarts(s).length,0);assert.equal(activeCheckingCart(s,user).cartNo,'KRT-ONE');
 s=migrateState(JSON.parse(JSON.stringify(s)));startWork(s,'CHECKING',ks[1].koliNo,user);checkKoliItem(s,ks[1].koliNo,a,'PO',3,'GOOD',user);checkKoliItem(s,ks[1].koliNo,b,'PO',2,'GOOD',user);finishKoliCheck(s,ks[1].koliNo,{},user);
 assert.deepEqual(cartBalance(s,'KRT-ONE'),{qty:10,skuCount:2,koliCount:2});assert.equal(closedCartQueue(s).length,0);
 reject(s,d=>openCheckingCart(d,'NEW',user),/Close kereta aktif/);
 closeCheckingCart(s,'KRT-ONE',user);assert(!activeCheckingCart(s,user));assert.equal(closedCartQueue(s)[0].ready,true);assert.equal(readyPutawayCarts(s)[0].items.find(i=>i.sku===a).qty,8);
 assert.equal(processHistory(s).carts[0].qty,10);assert.equal(processHistory(s).carts[0].rows.length,3);reject(s,d=>closeCheckingCart(d,'KRT-ONE',user),/sudah close/);reject(s,d=>openCheckingCart(d,'KRT-ONE',user),/sudah close/);
 openCheckingCart(s,'KRT-NEXT',user);assert.equal(activeCheckingCart(s,user).cartNo,'KRT-NEXT');
 startWork(s,'PUTAWAY','STAGING',user);const runId=startCartPutaway(s,'KRT-ONE',user);for(const sku of [a,b])putawayFromCart(s,{...selectCartItem(s,'KRT-ONE',sku),runId,to:'A01-1-01'},user);
 assert.equal(closedCartQueue(s).length,0);closeCheckingCart(s,'KRT-NEXT',user);openCheckingCart(s,'KRT-ONE',user);assert.equal(s.checkingCarts.filter(c=>c.cartNo==='KRT-ONE').length,2);
});
test('Cart can close mid-koli, is visible but held in Putaway, and new cart continues the same koli',()=>{
 const {s,a,ks}=prepare();beginKoliCart(s,ks[0].koliNo,'PART-1',user);checkKoliItem(s,ks[0].koliNo,a,'PO',2,'GOOD',user);closeCheckingCart(s,'PART-1',user);
 assert.equal(closedCartQueue(s)[0].ready,false);assert.equal(readyPutawayCarts(s).length,0);reject(s,d=>checkKoliItem(d,ks[0].koliNo,a,'PO',1,'GOOD',user,'PART-1'),/sudah close/);
 openCheckingCart(s,'PART-2',user);checkKoliItem(s,ks[0].koliNo,a,'PO',3,'GOOD',user);finishKoliCheck(s,ks[0].koliNo,{},user);
 assert.equal(readyPutawayCarts(s)[0].cartNo,'PART-1');assert.equal(readyPutawayCarts(s)[0].qty,2);assert.equal(activeCheckingCart(s,user).cartNo,'PART-2');
});
test('Closed discrepancy carts remain visible and become ready only after the required approval',()=>{
 const {s,a,ks}=prepare();beginKoliCart(s,ks[0].koliNo,'HELD',user);checkKoliItem(s,ks[0].koliNo,a,'PO',4,'GOOD',user);finishKoliCheck(s,ks[0].koliNo,{[`${a}|PO`]:'SHORT_SHIPMENT'},user);closeCheckingCart(s,'HELD',user);
 assert.equal(closedCartQueue(s)[0].qty,4);assert.equal(closedCartQueue(s)[0].ready,false);
 approve(s,s.approvals[0].id,'SPV',true,'Checked',user);assert.equal(closedCartQueue(s)[0].ready,false);approve(s,s.approvals[0].id,'MANAGER',true,'Checked',user);assert.equal(closedCartQueue(s)[0].ready,true);
});
test('Migration preserves existing test progress and recovers legacy carts without closing them automatically',()=>{
 const {s,a,ks}=prepare();beginKoliCart(s,ks[0].koliNo,'OLD',user);checkKoliItem(s,ks[0].koliNo,a,'PO',5,'GOOD',user);finishKoliCheck(s,ks[0].koliNo,{},user);
 delete s.cartLifecycleVersion;delete s.checkingCarts;const before=structuredClone(s);migrateState(s);
 for(const key of ['stock','kolis','receipts','movements','workSessions','workEvents','queue'])assert.deepEqual(s[key],before[key]);assert.equal(s.checkingCarts[0].status,'OPEN');assert.equal(s.checkingCarts[0].userId,null);assert.equal(readyPutawayCarts(s).length,0);
 openCheckingCart(s,'OLD',user);migrateState(s);assert.equal(s.checkingCarts.length,1);assert.equal(activeCheckingCart(s,user).cartNo,'OLD');
});
test('Operators cannot steal or close another operator’s open cart',()=>{
 const {s}=prepare();openCheckingCart(s,'OWNED',user);reject(s,d=>openCheckingCart(d,'OWNED','OP-OUT-01'),/operator lain/);reject(s,d=>closeCheckingCart(d,'OWNED','OP-OUT-01'),/operator lain/);
});
