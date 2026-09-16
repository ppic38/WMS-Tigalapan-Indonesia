import {createCapacityBatches,scanPickingCart,claimPickBatch,pickCartBatchItem,packingCartRows,openPackingKoli,packCartIntoKoli,sealPackingKoli} from '../src/lib/outbound.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,available,physical,reserved,applyMutation,newId} from '../src/lib/data.js';
import {createTestingState,prepareTestingState,prepareTestingPreferences,emptyTestingCollections,TEST_DATASET_ID,generateTestingResi} from '../src/lib/testing-data.js';
import {canAccess} from '../src/lib/access.js';
import {parseCSV,csv,barcodeSVG} from '../src/lib/files.js';
import {validatePackingList,importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,startCartPutaway,selectCartItem,putawayFromCart,createPickBatch,pickBatchItem,packFinishedItem,sealPacking,shipWithWork} from '../src/lib/phase1.js';
import {startWork,productivity} from '../src/lib/productivity.js';
import {saveAllocation} from '../src/lib/actions.js';
import {readyPutawayCarts,closeCheckingCart} from '../src/lib/carts.js';
import {receivingQueues} from '../src/lib/receiving-queues.js';
import {processHistory} from '../src/lib/reports.js';
import {simulate} from '../web/js/lib/allocation.js';
const make=()=>createTestingState(seed()),inbound='OP-IN-01',outbound='OP-OUT-01';
test('Fresh test dataset clears all old operations and fills every required SKU/store/user/location reference',()=>{
 const s=make();for(const key of emptyTestingCollections)assert.deepEqual(s[key],[],key);
 assert.equal(s.items.length,20);assert.equal(s.stores.length,12);assert.equal(s.workers.length,8);assert.equal(s.appUsers.length,8);assert.equal(s.roles.length,6);
 assert.equal(s.testing.packingRows.length,20);assert.equal(s.testing.packingRows.reduce((n,r)=>n+r.qty,0),1400);
 assert.equal(new Set(s.testing.packingRows.map(r=>r.vendorKoliNo)).size,5);
 assert.equal(validatePackingList(s,parseCSV(csv(s.testing.packingRows))).errors.length,0);
 assert.equal(Object.keys(s.demand).length,240);assert.equal(Object.keys(s.classification).length,240);assert.equal(Object.keys(s.safety).length,36);
 for(const row of s.testing.planned){assert(s.locations.some(l=>l.locationCode===row.locationCode&&l.allocatable&&l.capacity>=s.testing.packingRows.find(r=>r.sku===row.sku).qty));assert(barcodeSVG(row.cartNo));assert(barcodeSVG(row.sku));assert(barcodeSVG(row.locationCode));}
 for(const item of s.items){assert(s.codeMaster.color[item.color]);for(const st of s.stores){const k=`${st.storeId}_${item.sku}`;assert(s.demand[k].dad>0);assert(s.safety[`${st.storeId}_${s.classification[k].class}`]);assert.equal(s.oh[k],0);assert.equal(s.od[k],0)}}
 for(const u of s.appUsers){assert(s.workers.some(w=>w.id===u.workerId&&w.active));assert(s.roles.some(r=>r.id===u.roleId&&r.active));}
 for(const [id,menu] of [['USER-ADMIN','settings-users'],['USER-OP-IN-01','receiving'],['USER-OP-IN-02','putaway'],['USER-OP-PPIC-01','allocation'],['USER-OP-OUT-01','picking'],['USER-OP-OUT-02','packing'],['USER-OP-SPV-01','approvals'],['USER-OP-MGR-01','approvals']])assert(canAccess(s,id,menu));
});
test('Authorized reset runs once, replaces even high-revision old data, and never erases new progress on refresh',()=>{
 const old=seed();old.revision=999;old.receipts[0].externalResiNo='OLD';old.appUsers[0].name='OLD';
 const fresh=prepareTestingState(old,seed);assert.equal(fresh.revision,1000);assert.equal(fresh.receipts.length,0);assert.equal(fresh.testing.id,TEST_DATASET_ID);assert.equal(old.receipts[0].externalResiNo,'OLD');
 const progressed=applyMutation(fresh,d=>importPackingList(d,d.testing.packingRows,'test.csv',inbound));
 assert.equal(prepareTestingState(progressed,()=>{throw Error('must not reset')}),progressed);assert.equal(progressed.kolis.length,5);assert.equal(progressed.revision,1001);
 const data=new Map([['wms38-account','DELETED-USER']]),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 assert.equal(prepareTestingPreferences(storage),true);assert.equal(data.get('wms38-account'),'USER-ADMIN');data.set('wms38-account','USER-OP-IN-01');
 assert.equal(prepareTestingPreferences(storage),false);assert.equal(data.get('wms38-account'),'USER-OP-IN-01');
});
for(const mode of ['legacy','cart','generated-cycle','generated-mixed'])test(`20-line Receiving → cart Putaway → 12-store allocation → ${mode} picking → packing → shipping`,()=>{
 let s=make();const generated=mode.startsWith('generated-')?generateTestingResi(s,mode.slice(10)):null;const rows=parseCSV(csv(generated?.rows||s.testing.packingRows)),total=rows.reduce((n,r)=>n+Number(r.qty),0),koliCount=new Set(rows.map(r=>r.vendorKoliNo)).size;const receiptId=importPackingList(s,rows,s.testing.filename,inbound)[0];
 assert.equal(receivingQueues(s).pendingKolis.length,koliCount);assert.equal(s.stock.length,0);
 startWork(s,'RECEIVING',receiptId,inbound);for(const k of s.kolis)receiveKoli(s,receiptId,k.vendorKoliNo,inbound);confirmKoliIntake(s,receiptId,inbound);
 for(const [i,k] of s.kolis.entries()){const cart=`KRT-UJI-${String(i+1).padStart(3,'0')}`;beginKoliCart(s,k.koliNo,cart,inbound);for(const r of k.expectedItems)checkKoliItem(s,k.koliNo,r.sku,r.poNumber,r.qtyExpected,'GOOD',inbound,cart);finishKoliCheck(s,k.koliNo,{},inbound);closeCheckingCart(s,cart,inbound)}
 assert.equal(receivingQueues(s).count,0);assert.equal(readyPutawayCarts(s).length,koliCount);assert.equal(s.stock.reduce((n,r)=>n+r.qty,0),total);
 for(const cart of readyPutawayCarts(s)){startWork(s,'PUTAWAY','STAGING',inbound);const runId=startCartPutaway(s,cart.cartNo,inbound);for(const item of cart.items){const f={...selectCartItem(s,cart.cartNo,item.sku),runId,to:s.testing.planned.find(p=>p.sku===item.sku).locationCode};putawayFromCart(s,f,inbound)}}
 assert.equal(readyPutawayCarts(s).length,0);assert.equal(s.items.reduce((n,i)=>n+available(s,i.sku),0),total);
 const params={},av={};for(const i of s.items){av[i.sku]=available(s,i.sku);for(const st of s.stores){const k=`${st.storeId}_${i.sku}`,c=s.classification[k].class,ss=s.safety[`${st.storeId}_${c}`];params[k]={dad:s.demand[k].dad,oc:st.orderCycleDays,lt:st.leadTimeDays,ssd:ss.ssDemandDays,sslt:ss.ssLeadTimeDays,oh:s.oh[k],od:s.od[k],itemClass:c}}}
 const allocation=simulate({items:s.items,stores:s.stores,params,available:av,method:'FAIR_SHARE_COVERAGE'});
 assert(allocation.every(r=>r.lines.every(l=>!l.needsManualReview)));assert.equal(allocation.flatMap(r=>r.lines).reduce((n,l)=>n+l.allocatedQty,0),total);
 saveAllocation(s,allocation,'FAIR_SHARE_COVERAGE',true,'OP-PPIC-01','2026-09-07');assert.equal(s.picks.length,12);
 if(mode==='legacy'){
 const batchId=createPickBatch(s,{pickIds:s.picks.map(p=>p.id),assigneeId:outbound,startLocation:'A01-1-01'},'OP-ADMIN');startWork(s,'PICKING',batchId,outbound);
 for(const task of s.pickBatches[0].tasks)pickBatchItem(s,batchId,task.id,{sku:task.sku,location:task.location,qty:task.qty},outbound);
 assert.equal(s.pickBatches[0].status,'FINISHED');
 for(const p of s.picks){startWork(s,'PACKING',p.id,'OP-OUT-02');for(const l of p.lines)if(l.qty)packFinishedItem(s,p.id,l.sku,l.qty,'OP-OUT-02');sealPacking(s,p.id,'OP-OUT-02')}
 }else{
  const ids=createCapacityBatches(s,{pickIds:s.picks.map(p=>p.id),capacity:60,startLocation:'A01-1-01'},outbound);assert(mode==='generated-mixed'?ids.length>=12:ids.length>12);
  for(const [i,id] of ids.entries()){
   const cartNo='KRT-OUT-001';scanPickingCart(s,cartNo,outbound,60);claimPickBatch(s,id,outbound);const batch=s.pickBatches.find(b=>b.id===id);
   for(const task of batch.tasks)pickCartBatchItem(s,id,task.id,{sku:task.sku,location:task.location,qty:task.qty,cartNo,requestId:newId()},outbound);
   assert.equal(batch.status,'FINISHED');const koliNo=`KO-E2E-${i+1}`;openPackingKoli(s,koliNo,batch.storeId,'OP-OUT-02');
   for(const sku of new Set(batch.tasks.map(t=>t.sku))){const amount=packingCartRows(s,{storeId:batch.storeId,cartNo,sku}).reduce((n,r)=>n+r.remaining,0);packCartIntoKoli(s,{koliNo,cartNo,sku,qty:amount,requestId:newId()},'OP-OUT-02');}
   sealPackingKoli(s,koliNo,'OP-OUT-02');
  }
  assert(s.pickingCartRuns.every(c=>c.status==='FINISHED'));
 }
 startWork(s,'SHIPPING','DISPATCH',outbound);for(const o of s.orders)shipWithWork(s,o.doNumber,outbound);
 assert.equal(s.orders.length,mode==='legacy'?12:s.pickBatches.length);assert(s.orders.every(o=>o.status==='SHIPPED'));
 for(const item of s.items){assert.equal(physical(s,item.sku),0);assert.equal(reserved(s,item.sku),0)}
 assert.equal(Object.values(s.od).reduce((n,q)=>n+q,0),total);assert(s.queue.every(q=>q.status==='WAITING_CONFIGURATION'));
 const history=processHistory(s);assert.deepEqual(['packing_lists','receiving','checking','putaway','picking','packing','shipping'].map(k=>history[k].length),[1,koliCount,koliCount,20,s.pickBatches.length,s.orders.length,s.orders.length]);
 const metrics=productivity(s,{end:Date.now()+1000});for(const p of ['CHECKING','PUTAWAY','PICKING','PACKING','SHIPPING'])assert.equal(metrics.teams.filter(t=>t.process===p).reduce((n,t)=>n+t.qty,0),total);
 if(generated){assert.equal(s.receiptItemCosts.length,20);for(const row of generated.rows)assert(s.receiptItemCosts.some(c=>c.vendorKoliNo===row.vendorKoliNo&&c.sku===row.sku&&c.poNumber===row.poNumber&&c.hppPerItem===row['hpp/item']));}
 assert.equal(prepareTestingState(s,seed),s);
});

test('Every download creates a valid distinct resi and scenario contents without adding operational stock',()=>{
 const s=make(),seen=new Set(),snap=structuredClone(s.stock),at='2026-09-09T03:00:00.000Z';
 for(let i=0;i<18;i++){
  const scenario=['cycle','mixed','reserve'][i%3],p=generateTestingResi(s,scenario,at,'fixed-token-for-sequence-check');
  assert.equal(p.sequence,i+1);assert(!seen.has(p.rows[0].externalResiNo));seen.add(p.rows[0].externalResiNo);
  assert.equal(validatePackingList(s,parseCSV(csv(p.rows))).errors.length,0);
  assert.equal(p.rows.length,scenario==='reserve'?4:20);
  assert.equal(new Set(p.rows.map(r=>r.vendorKoliNo)).size,p.rows[0].totalKoli);
  if(scenario==='mixed')assert(new Set(p.rows.map(r=>r.sku)).size<p.rows.length);
  if(i>2)assert.notDeepEqual(p.rows.map(r=>[r.sku,r.qty,r.totalKoli]),s.testing.resiDownloads[i-3].rows.map(r=>[r.sku,r.qty,r.totalKoli]));
 }
 assert.deepEqual(s.stock,snap);assert.equal(s.receipts.length,0);assert.equal(s.testing.resiDownloads.length,18);
 const reloaded=prepareTestingState(JSON.parse(JSON.stringify(s)),seed);assert.equal(generateTestingResi(reloaded,'cycle',at,'fixed-token-for-sequence-check').sequence,19);
 const first=s.testing.resiDownloads[0],second=s.testing.resiDownloads[3];importPackingList(s,first.rows,first.filename,inbound);importPackingList(s,second.rows,second.filename,inbound);assert.equal(s.receipts.length,2);
});

test('New reset removes outbound carts/parcels and refills cart masters while preserving later testing',()=>{
 const old=make();old.testing.id='full-cycle-previous';old.pickingCartRuns.push({id:'old',status:'OPEN'});old.packingKolis.push({koliNo:'old',status:'OPEN'});old.cartMasters.push({cartNo:'OLD',capacity:1});old.warehouseLayout={old:true};
 const fresh=prepareTestingState(old,seed);assert.equal(fresh.pickingCartRuns.length,0);assert.equal(fresh.packingKolis.length,0);assert.equal(fresh.cartMasters.length,7);assert(!fresh.cartMasters.some(c=>c.cartNo==='OLD'));assert.equal(fresh.warehouseLayout,undefined);
 assert(fresh.cartMasters.every(c=>c.capacity>0));assert.equal(prepareTestingState(fresh,seed),fresh);
});
