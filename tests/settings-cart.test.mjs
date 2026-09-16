import {seed} from './mapped-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMutation,migrateState,physical} from '../src/lib/data.js';
import {canAccess,effectiveMenus,requireMenu,saveAppUser,saveRole,saveSystemSettings,menuCatalog} from '../src/lib/access.js';
import {readyPutawayCarts,closeCheckingCart} from '../src/lib/carts.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,startCartPutaway,selectCartItem,putawayFromCart} from '../src/lib/phase1.js';
import {startWork,stopWork,activeWork,productivity} from '../src/lib/productivity.js';
import {approve} from '../src/lib/actions.js';
import {decodeBarcodeImage,readBarcodePhoto} from '../src/lib/barcode.js';
const user='OP-IN-01',admin='USER-ADMIN',inbound='USER-OP-IN-01';
function reject(s,fn,pattern){const before=structuredClone(s);assert.throws(()=>applyMutation(s,fn),pattern);assert.deepEqual(s,before)}
function shipment(s,id,items){const r=importPackingList(s,items.map(([sku,qty])=>({packingListNo:id,vendorName:'Vendor',externalResiNo:id,expedition:'Uji',totalKoli:1,vendorKoliNo:id,sku,qty})),'test.csv',user)[0];const k=s.kolis.find(k=>k.internalResiNo===r);startWork(s,'RECEIVING',r,user);receiveKoli(s,r,k.koliNo,user);confirmKoliIntake(s,r,user);return k}
function fill(s,k,items,cart='KRT-01'){beginKoliCart(s,k.koliNo,cart,user);for(const [sku,qty] of items)checkKoliItem(s,k.koliNo,sku,'',qty,'GOOD',user,cart);finishKoliCheck(s,k.koliNo,{},user)}

test('Settings migration preserves documents, balances and history while initializing manageable local accounts',()=>{
 const s=seed(),old=structuredClone(s);delete s.roles;delete s.appUsers;delete s.systemSettings;delete s.settingsVersion;delete s.settingsAudit;delete s.cartRuns;
 migrateState(s);for(const key of ['stock','kolis','receipts','movements','workEvents'])assert.deepEqual(s[key],old[key]);
 assert.equal(effectiveMenus(s,admin).length,menuCatalog.length);assert(canAccess(s,inbound,'putaway'));assert(!canAccess(s,inbound,'settings-users'));assert(canAccess(s,inbound,'activity'));
});
test('Role inheritance, per-user overrides, inactive users and route guards use current permissions',()=>{
 const s=seed(),u=s.appUsers.find(u=>u.id===inbound);saveAppUser(s,{...u,menuOverrides:{putaway:false,packing:true}},admin);
 assert(!canAccess(s,inbound,'putaway'));assert(canAccess(s,inbound,'packing'));assert(canAccess(s,inbound,'receiving'));
 reject(s,d=>{requireMenu(d,inbound,'putaway');d.stock=[]},/akses/);
 const role=s.roles.find(r=>r.id==='INBOUND');saveRole(s,{...role,menus:[]},admin);
 assert.deepEqual(effectiveMenus(s,inbound),['packing']);assert(!canAccess(s,inbound,'activity'));
 saveAppUser(s,{...u,active:false},admin);assert.deepEqual(effectiveMenus(s,inbound),[]);
 reject(s,d=>saveRole(d,role,inbound),/akses/);
});
test('User/role validation prevents duplicate names, last-admin lockout and invalid worker links',()=>{
 const s=seed(),u=s.appUsers.find(u=>u.id===admin),r=s.roles.find(r=>r.id==='ADMIN');
 reject(s,d=>saveAppUser(d,{...u,active:false},admin),/Administrator/);
 reject(s,d=>saveAppUser(d,{...u,id:undefined},admin),/Username/);
 reject(s,d=>saveAppUser(d,{...u,workerId:'NO'},admin),/operator aktif/);
 reject(s,d=>saveRole(d,{...r,active:false},admin),/Administrator/);
 reject(s,d=>saveRole(d,{...s.roles.find(r=>r.id==='INBOUND'),active:false},admin),/user aktif/);
 saveRole(s,{...r,menus:[]},admin);assert.equal(effectiveMenus(s,admin).length,menuCatalog.length);
 startWork(s,'PUTAWAY','STAGING',user);reject(s,d=>saveAppUser(d,{...u,workerId:'OP-OUT-01'},admin),/Jeda/);
});
test('System preferences validate and are retained with an attributable audit trail',()=>{
 const s=seed();saveSystemSettings(s,{companyName:'Gudang Uji',warehouseName:'DC 02',landingPage:'receiving',tablePageSize:'25'},admin);
 assert.equal(s.systemSettings.tablePageSize,25);assert.equal(s.settingsAudit.at(-1).actor,'Administrator');
 reject(s,d=>saveSystemSettings(d,{...s.systemSettings,tablePageSize:0},admin),/tidak valid/);
 reject(s,d=>saveSystemSettings(d,s.systemSettings,inbound),/akses/);
});
test('Cart cycle defaults qty, saves partial quantities, rejects duplicate/stale requests, finishes and reuses cart',()=>{
 const s=seed();s.stock=[];const [a,b]=s.items.map(i=>i.sku),items=[[a,8],[b,4]],k=shipment(s,'PL-CYCLE',items);fill(s,k,items);closeCheckingCart(s,'KRT-01',user);
 assert.equal(readyPutawayCarts(s)[0].qty,12);
 startWork(s,'PUTAWAY','STAGING',user);const runId=startCartPutaway(s,'krt-01',user),f={...selectCartItem(s,'KRT-01',a),runId,to:'A01-1-01'};
 assert.equal(f.qty,8);putawayFromCart(s,{...f,qty:3},user);assert.equal(readyPutawayCarts(s)[0].qty,9);
 reject(s,d=>putawayFromCart(d,{...f,qty:3},user),/sudah tersimpan/);
 reject(s,d=>putawayFromCart(d,{...f,requestId:'different',qty:3},user),/berubah/);
 for(const sku of [a,b])putawayFromCart(s,{...selectCartItem(s,'KRT-01',sku),runId,to:'A01-1-01'},user);
 assert.equal(readyPutawayCarts(s).length,0);assert.equal(s.cartRuns[0].status,'FINISHED');assert(!activeWork(s,user));
 assert.equal(physical(s,a),8);assert.equal(physical(s,b),4);assert.equal(s.workEvents.filter(e=>e.process==='PUTAWAY').reduce((n,e)=>n+e.qty,0),12);
 assert.equal(s.movements.filter(m=>m.type==='PUTAWAY').length,3);assert(s.movements.filter(m=>m.type==='PUTAWAY').every(m=>m.cartNo==='KRT-01'&&m.operationId));
 assert.equal(s.queue.filter(e=>e.target==='MOKA'&&e.event==='PUTAWAY').reduce((n,e)=>n+e.payload.qty,0),12);
 const next=shipment(s,'PL-REUSE',[[a,2]]);fill(s,next,[[a,2]]);closeCheckingCart(s,'KRT-01',user);assert.equal(readyPutawayCarts(s)[0].qty,2);
 startWork(s,'PUTAWAY','STAGING',user);const nextRun=startCartPutaway(s,'KRT-01',user);assert.notEqual(nextRun,runId);
 reject(s,d=>putawayFromCart(d,{...selectCartItem(d,'KRT-01',a),runId,to:'A01-1-01'},user),/sesi kereta/);
 putawayFromCart(s,{...selectCartItem(s,'KRT-01',a),runId:nextRun,to:'A01-1-01'},user);
 const metric=productivity(s,{end:Date.now()+1000}).people.find(p=>p.process==='PUTAWAY');assert.equal(metric.lines,3);assert.equal(metric.qty,14);
});
test('Cart selection excludes legacy staging, unfinished checking and unresolved discrepancies',()=>{
 const s=seed();assert.equal(readyPutawayCarts(s).length,0);const [a,b]=s.items.map(i=>i.sku),k=shipment(s,'PL-A',[[a,3]]),other=shipment(s,'PL-B',[[b,2]]);
 fill(s,k,[[a,3]]);beginKoliCart(s,other.koliNo,'KRT-01',user);checkKoliItem(s,other.koliNo,b,'',1,'GOOD',user,'KRT-01');
 assert.equal(readyPutawayCarts(s).length,0);
 finishKoliCheck(s,other.koliNo,{[`${b}|PL-B`]:'SHORT_SHIPMENT'},user);assert.equal(readyPutawayCarts(s).length,0);
 const approval=s.approvals.find(a=>a.status==='PENDING_SPV');approve(s,approval.id,'SPV',true,'Cek',user);approve(s,approval.id,'MANAGER',true,'Cek',user);
 closeCheckingCart(s,'KRT-01',user);assert.equal(readyPutawayCarts(s)[0].qty,4);
});
test('A cart in putaway cannot receive new contents and invalid saves are atomic',()=>{
 const s=seed();s.stock=[];const sku=s.items[0].sku,k=shipment(s,'PL-A',[[sku,3]]),other=shipment(s,'PL-B',[[sku,1]]);fill(s,k,[[sku,3]]);closeCheckingCart(s,'KRT-01',user);
 startWork(s,'PUTAWAY','STAGING',user);const runId=startCartPutaway(s,'KRT-01',user),f={...selectCartItem(s,'KRT-01',sku),runId,to:'A01-1-01'};
 for(const bad of [{qty:4},{qty:0},{qty:1.5},{to:'Q01-1-01'},{to:'UNKNOWN'},{sku:'UNKNOWN'},{cartNo:'KRT-X'},{runId:'NO'}])reject(s,d=>putawayFromCart(d,{...f,...bad},user),/./);
 stopWork(s,activeWork(s,user).id,user);reject(s,d=>putawayFromCart(d,f,user),/Mulai kerja/);
 reject(s,d=>beginKoliCart(d,other.koliNo,'KRT-01',user),/masih dalam proses putaway/);
 beginKoliCart(s,other.koliNo,'KRT-02',user);reject(s,d=>checkKoliItem(d,other.koliNo,sku,'',1,'GOOD',user,'KRT-01'),/masih dalam proses/);
});
test('Photo decoder rejects invalid files and ambiguous labels and falls back when native decoding is unavailable',async()=>{
 await assert.rejects(readBarcodePhoto({type:'text/plain',size:1}),/file foto/);
 await assert.rejects(readBarcodePhoto({type:'image/png',size:13*1024*1024}),/12 MB/);
 const native=globalThis.BarcodeDetector,zxing=globalThis.ZXing;let resets=0;
 try{
  globalThis.BarcodeDetector=class{async detect(){return [{rawValue:'KRT-01'}]}};assert.equal(await decodeBarcodeImage({}),'KRT-01');
  globalThis.BarcodeDetector=class{async detect(){return [{rawValue:'A'},{rawValue:'B'}]}};await assert.rejects(decodeBarcodeImage({}),/beberapa barcode/);
  globalThis.BarcodeDetector=class{async detect(){throw Error('unsupported')}};
  globalThis.ZXing={BrowserMultiFormatReader:class{async decodeFromImageElement(){return {getText:()=> 'SKU-01'}}reset(){resets++}}};
  assert.equal(await decodeBarcodeImage({}),'SKU-01');assert.equal(resets,1);
 }finally{globalThis.BarcodeDetector=native;globalThis.ZXing=zxing}
});
