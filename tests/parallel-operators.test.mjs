import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from './mapped-fixture.mjs';
import {applyMutation,newId,physical} from '../src/lib/data.js';
import {startWork,stopWork,activeWork} from '../src/lib/productivity.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,startCartPutaway,selectCartItem,putawayFromCart} from '../src/lib/phase1.js';
import {closeCheckingCart,readyPutawayCarts} from '../src/lib/carts.js';
const a='OP-IN-01',b='OP-OUT-01';
function setup(){let s=seed();s.stock=[];const sku=s.items[0].sku;const id=importPackingList(s,['K1','K2'].map(vendorKoliNo=>({vendorName:'Parallel',externalResiNo:'PARALLEL',expedition:'UJI',totalKoli:2,vendorKoliNo,poNumber:'PO',sku,qty:4})),'parallel.csv',a)[0];return {s,id,sku,ks:s.kolis.filter(k=>k.internalResiNo===id).map(k=>k.koliNo)}}
function rejected(s,fn,re){const before=structuredClone(s);assert.throws(()=>applyMutation(s,fn),re);assert.deepEqual(s,before)}
test('Two intake operators share a resi; duplicate arrival is rejected and quantities stay exact',()=>{
 const {s,id,ks}=setup();startWork(s,'RECEIVING',id,a);startWork(s,'RECEIVING',id,b);receiveKoli(s,id,ks[0],a);
 rejected(s,d=>receiveKoli(d,id,ks[0],b),/sudah/);receiveKoli(s,id,ks[1],b);confirmKoliIntake(s,id,b);
 assert.equal(s.workEvents.filter(e=>e.process==='RECEIVING').reduce((n,e)=>n+e.qty,0),2);assert(!activeWork(s,a));assert(!activeWork(s,b));
});
test('Different koli and carts progress in parallel; same koli stays exclusive while paused; finishing one leaves the other running',()=>{
 const {s,id,sku,ks}=setup();startWork(s,'RECEIVING',id,a);for(const k of ks)receiveKoli(s,id,k,a);confirmKoliIntake(s,id,a);
 beginKoliCart(s,ks[0],'CART-A',a);rejected(s,d=>beginKoliCart(d,ks[0],'CART-B',b),/operator lain/);
 stopWork(s,activeWork(s,a).id,a);rejected(s,d=>startWork(d,'CHECKING',ks[0],b),/operator lain/);startWork(s,'CHECKING',ks[0],a);
 beginKoliCart(s,ks[1],'CART-B',b);checkKoliItem(s,ks[0],sku,'PO',2,'GOOD',a);checkKoliItem(s,ks[1],sku,'PO',4,'GOOD',b);checkKoliItem(s,ks[0],sku,'PO',2,'GOOD',a);
 finishKoliCheck(s,ks[0],{},a);assert.equal(activeWork(s,b).reference,ks[1]);closeCheckingCart(s,'CART-A',a);
 // Putaway starts while the second operator is still checking a different koli.
 startWork(s,'PUTAWAY','STAGING',a);const runA=startCartPutaway(s,'CART-A',a);
 finishKoliCheck(s,ks[1],{},b);closeCheckingCart(s,'CART-B',b);startWork(s,'PUTAWAY','STAGING',b);
 rejected(s,d=>startCartPutaway(d,'CART-A',b),/operator lain/);
 const form={...selectCartItem(s,'CART-A',sku),runId:runA,to:'A01-1-01'};
 rejected(s,d=>putawayFromCart(d,form,b),/operator lain/);
 rejected(s,d=>startCartPutaway(d,'CART-B',a),/kereta putaway aktif/);
 const runB=startCartPutaway(s,'CART-B',b);putawayFromCart(s,form,a);assert.equal(activeWork(s,b).process,'PUTAWAY');
 rejected(s,d=>putawayFromCart(d,form,a),/sudah tersimpan/);
 putawayFromCart(s,{...selectCartItem(s,'CART-B',sku),runId:runB,to:'A01-1-01'},b);
 assert.equal(physical(s,sku),8);assert.equal(readyPutawayCarts(s).length,0);assert.equal(s.cartRuns.filter(r=>r.status==='FINISHED').length,2);
 assert.deepEqual(s.workEvents.filter(e=>e.process==='PUTAWAY').map(e=>[e.userId,e.qty]),[[a,4],[b,4]]);
});
