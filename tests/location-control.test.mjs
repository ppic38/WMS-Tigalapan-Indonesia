import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyMutation,available} from '../src/lib/data.js';
import {createTestingState,prepareTestingState,TEST_DATASET_ID} from '../src/lib/testing-data.js';
import {canAccess} from '../src/lib/access.js';
import {saveLocationMapping,saveLocationCapacity,locationCapacity,putawayGuidance,activePutawayLocation,locationAssignments,mappingValue} from '../src/lib/locations.js';
import {processHistory} from '../src/lib/reports.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,startCartPutaway,selectCartItem,putawayFromCart} from '../src/lib/phase1.js';
import {startWork} from '../src/lib/productivity.js';
import {closeCheckingCart,readyPutawayCarts} from '../src/lib/carts.js';

const make=()=>createTestingState(seed()),admin='USER-ADMIN',operator='OP-IN-01';
function checkedCart(s,rows,cart){
 const receipt=importPackingList(s,rows,'test.csv',operator)[0];
 startWork(s,'RECEIVING',receipt,operator);
 const kolis=s.kolis.filter(k=>k.internalResiNo===receipt);
 for(const k of kolis)receiveKoli(s,receipt,k.vendorKoliNo,operator);
 confirmKoliIntake(s,receipt,operator);
 for(const k of kolis){beginKoliCart(s,k.koliNo,cart,operator);for(const r of k.expectedItems)checkKoliItem(s,k.koliNo,r.sku,r.poNumber,r.qtyExpected,'GOOD',operator,cart);finishKoliCheck(s,k.koliNo,{},operator);}
 closeCheckingCart(s,cart,operator);
}
function put(s,cart,sku,to,qty){startWork(s,'PUTAWAY','STAGING',operator);const runId=startCartPutaway(s,cart,operator);putawayFromCart(s,{...selectCartItem(s,cart,sku),runId,to,qty},operator);}

test('Putaway checks current per-SKU mapping at save and rejected scans leave all ledgers unchanged',()=>{
 const s=make(),item=s.items[0],primary=item.primaryLocation,reserve=item.reserveLocations[0];
 checkedCart(s,s.testing.packingRows.slice(0,1).map(r=>({...r,totalKoli:1})),'KRT-MAPPING');
 startWork(s,'PUTAWAY','STAGING',operator);
 const runId=startCartPutaway(s,'KRT-MAPPING',operator),selection={...selectCartItem(s,'KRT-MAPPING',item.sku),runId,qty:2};
 const reject=(to,re)=>{const before=structuredClone(s);assert.throws(()=>applyMutation(s,d=>putawayFromCart(d,{...selection,to},operator)),re);assert.deepEqual(s,before)};
 reject(s.items[1].primaryLocation,/dipetakan/);
 reject(s.items[1].reserveLocations[0],/dipetakan/);
 item.primaryLocation='';item.reserveLocations=[];
 reject(primary,/belum memiliki lokasi/);
 item.primaryLocation=primary;item.reserveLocations=[reserve];
 const accepted=applyMutation(s,d=>putawayFromCart(d,{...selection,to:' '+primary.toLowerCase()+' '},operator));
 assert.equal(locationCapacity(accepted,primary).used,2);
 s.locations.find(l=>l.locationCode===primary).putawayBlocked=true;
 const acceptedReserve=applyMutation(s,d=>putawayFromCart(d,{...selection,to:reserve.toLowerCase()},operator));
 assert.equal(locationCapacity(acceptedReserve,reserve).used,2);
 item.reserveLocations=[];
 reject(reserve,/dipetakan/);
});

test('Location mapping is shared, keeps physical stock, validates unique reserve, and records before/after',()=>{
 let s=make();const item=s.items[0],before=mappingValue(item),other=s.items[1].reserveLocations[1];
 s.stock.push({sku:item.sku,locationCode:item.primaryLocation,qty:12});
 const stock=structuredClone(s.stock);
 const f={sku:item.sku,...before,abcClass:'C',reserveLocations:[...before.reserveLocations,other],expected:before};
 s=applyMutation(s,d=>saveLocationMapping(d,f,admin,'master'));
 assert.equal(s.items[0].abcClass,'C');assert.equal(s.items[0].reserveLocations.length,3);assert.deepEqual(s.stock,stock);
 assert(locationAssignments(s,other).some(r=>r.item.sku===item.sku&&r.kind==='Reserve'));
 assert.equal(processHistory(s).location_control.length,1);
 assert.throws(()=>applyMutation(s,d=>saveLocationMapping(d,f,admin,'master')),/berubah/);
 for(const reserveLocations of [[other,other],[item.primaryLocation],['Q01-1-01'],['']])assert.throws(()=>applyMutation(s,d=>saveLocationMapping(d,{sku:item.sku,...before,reserveLocations},admin,'master')),/duplikat|utama|aktif|kosong/);
 assert.throws(()=>applyMutation(s,d=>saveLocationMapping(d,{sku:item.sku,...before,primaryLocation:''},admin,'master')),/lokasi utama/);
 assert.equal(canAccess(s,'USER-OP-IN-01','location-control'),false);assert.equal(canAccess(s,'USER-OP-SPV-01','location-control'),true);assert.equal(canAccess(s,'USER-OP-PPIC-01','location-control'),true);
 assert.throws(()=>applyMutation(s,d=>saveLocationMapping(d,f,'USER-OP-IN-01')),/akses/);
});

test('Putaway guidance uses full primary, nearest suitable reserve, and total shared capacity',()=>{
 const s=make(),item=s.items[0],[near,far]=item.reserveLocations;
 let g=putawayGuidance(s,item.sku,40);assert.equal(g.status,'PRIMARY');assert.equal(g.recommended.code,item.primaryLocation);
 s.stock.push({sku:item.sku,locationCode:item.primaryLocation,qty:40});
 g=putawayGuidance(s,item.sku,20);assert.equal(g.status,'RESERVE');assert.equal(g.recommended.code,near);
 g=putawayGuidance(s,item.sku,160);assert.equal(g.recommended.code,far);
 s.stock.push({sku:s.items[1].sku,locationCode:near,qty:95});
 assert.equal(locationCapacity(s,near).free,5);assert.equal(putawayGuidance(s,item.sku,20).recommended.code,far);
 s.locations.find(l=>l.locationCode===far).putawayBlocked=true;
 g=putawayGuidance(s,item.sku,20);assert.equal(g.status,'SPLIT');assert.equal(g.recommended.qty,5);assert.equal(g.remainingQty,15);
 s.locations.find(l=>l.locationCode===near).capacity=null;
 assert.equal(putawayGuidance(s,item.sku,20).status,'NO_CAPACITY');
 assert.equal(putawayGuidance(s,item.sku,0).status,'INVALID_QTY');
});

test('Capacity changes reject stale edits and overfull limits, and manual full state affects guidance immediately',()=>{
 const s=make(),i=s.items[0],code=i.primaryLocation;
 s.stock.push({sku:i.sku,locationCode:code,qty:20});
 assert.throws(()=>applyMutation(s,d=>saveLocationCapacity(d,{locationCode:code,capacity:10},admin)),/lebih kecil/);
 const f={locationCode:code,capacity:50,putawayBlocked:true,expected:{capacity:40,putawayBlocked:false}};
 const changed=applyMutation(s,d=>saveLocationCapacity(d,f,admin));
 assert.equal(putawayGuidance(changed,i.sku,10).status,'RESERVE');
 assert.throws(()=>applyMutation(changed,d=>saveLocationCapacity(d,f,admin)),/berubah/);
 assert.deepEqual(changed.stock,s.stock);
});

test('Receiving → primary full → reserve and partial Putaway stays synchronized until cart is empty',()=>{
 let s=make();const initial=s.testing.packingRows.slice(0,4).map(r=>({...r,totalKoli:1}));
 checkedCart(s,initial,'KRT-TEST-1');
 for(const r of initial)put(s,'KRT-TEST-1',r.sku,s.items.find(i=>i.sku===r.sku).primaryLocation,r.qty);
 assert.equal(readyPutawayCarts(s).length,0);
 assert(s.items.slice(0,4).every(i=>locationCapacity(s,i.primaryLocation).free===0));
 checkedCart(s,s.testing.reserveRows,'KRT-TEST-2');
 const item=s.items[0];
 startWork(s,'PUTAWAY','STAGING',operator);const runId=startCartPutaway(s,'KRT-TEST-2',operator),f={...selectCartItem(s,'KRT-TEST-2',item.sku),runId,to:item.primaryLocation};
 const original=structuredClone(s);
 assert.throws(()=>applyMutation(s,d=>putawayFromCart(d,f,operator)),/panduan|Kapasitas/);assert.deepEqual(s,original);
 assert.throws(()=>applyMutation(s,d=>putawayFromCart(d,{...f,to:s.items[1].primaryLocation},operator)),/dipetakan/);
 const recommended=putawayGuidance(s,item.sku,20).recommended.code;
 s.locations.find(l=>l.locationCode===recommended).putawayBlocked=true;
 assert.throws(()=>applyMutation(s,d=>putawayFromCart(d,{...f,to:recommended},operator)),/penuh|panduan/);
 s.locations.find(l=>l.locationCode===recommended).putawayBlocked=false;
 for(const r of s.testing.reserveRows){
  let remaining=r.qty;
  while(remaining){const destination=activePutawayLocation(s,r.sku);if(!destination)break;const amount=Math.min(remaining,destination.free??remaining);put(s,'KRT-TEST-2',r.sku,destination.code,amount);remaining-=amount;}
 }
 const remaining=readyPutawayCarts(s)[0];assert.equal(remaining.qty,100);assert.equal(remaining.items.length,1);
 const last=s.items[3],code=s.items[4].reserveLocations[1];
 saveLocationMapping(s,{sku:last.sku,...mappingValue(last),reserveLocations:[...last.reserveLocations,code]},admin);
 const g=activePutawayLocation(s,last.sku);assert.equal(g.code,code);put(s,'KRT-TEST-2',last.sku,code,100);
 assert.equal(readyPutawayCarts(s).length,0);assert.equal(s.checkingCarts.find(c=>c.cartNo==='KRT-TEST-2').status,'FINISHED');
 assert.equal(s.items.reduce((n,i)=>n+available(s,i.sku),0),1100);
 assert.equal(processHistory(s).putaway.reduce((n,r)=>n+r.qty,0),1100);
 assert(s.locations.filter(l=>l.allocatable).every(l=>locationCapacity(s,l.locationCode).used<=l.capacity));
});

test('New authorized dataset resets prior testing once and provides all main/reserve/ABC references with empty stock',()=>{
 const old=createTestingState(seed());old.testing.id='receiving-test-20260906-01';old.revision=55;old.locationAudit.push({id:'old'});old.integration={lastResiPull:'old'};
 const s=prepareTestingState(old,seed);
 assert.equal(s.testing.id,TEST_DATASET_ID);assert.equal(s.revision,56);assert.deepEqual(s.stock,[]);assert.deepEqual(s.locationAudit,[]);assert.deepEqual(s.integration,{});
 assert.equal(s.items.length,20);assert.equal(s.items.reduce((n,i)=>n+i.reserveLocations.length,0),40);assert.equal(s.testing.reserveRows.length,4);
 for(const i of s.items){assert(['A','B','C'].includes(i.abcClass));assert(s.locations.some(l=>l.locationCode===i.primaryLocation));for(const code of i.reserveLocations)assert(s.locations.some(l=>l.locationCode===code));}
 s.items[0].abcClass='C';s.locationAudit.push({id:'new'});assert.equal(prepareTestingState(s,seed),s);assert.equal(s.locationAudit[0].id,'new');
});

test('Putaway exposes one active destination, keeps primary until full, then switches to nearest reserve',()=>{
 const s=make(),item=s.items[0],primary=item.primaryLocation,[near]=item.reserveLocations;
 let target=activePutawayLocation(s,item.sku);assert.equal(target.code,primary);assert.equal(target.kind,'Utama');
 s.stock.push({sku:item.sku,locationCode:primary,qty:locationCapacity(s,primary).free-1});
 target=activePutawayLocation(s,item.sku);assert.equal(target.code,primary);assert.equal(target.free,1);
 s.stock.find(r=>r.sku===item.sku&&r.locationCode===primary).qty++;
 target=activePutawayLocation(s,item.sku);assert.equal(target.code,near);assert.equal(target.kind,'Reserve');
});
