import {seed} from './mapped-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateState,applyMutation,physical,available,reserved,norm} from '../src/lib/data.js';
import {packingColumns,validatePackingList,importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck,putawayItem,createPickBatch,pickBatchItem,shortBatchItem,replanBatch,cancelBatch,packFinishedItem,sealPacking,shipWithWork,locationDistance} from '../src/lib/phase1.js';
import {startWork,stopWork,productivity,saveWorker,recordWork} from '../src/lib/productivity.js';
import {scanItem,closeKoli,saveAllocation,pickItem,packItem,ship} from '../src/lib/actions.js';
import {calculateSOQ} from '../web/js/lib/allocation.js';
import {processHistory} from '../src/lib/reports.js';
import {parseCSV,csv} from '../src/lib/files.js';
const inbound='OP-IN-01',outbound='OP-OUT-01';
function manifest(s){const common={packingListNo:'PL-VENDOR-01',vendorName:'Vendor QA',shippingDate:'2026-09-06',externalResiNo:'RESI-QA',expedition:'Ekspedisi QA',totalKoli:'2'};return [{...common,vendorKoliNo:'V-K01',sku:s.items[0].sku,qty:'10',poNumber:'PO-A'},{...common,vendorKoliNo:'V-K01',sku:s.items[1].sku,qty:'8',poNumber:'PO-B'},{...common,vendorKoliNo:'V-K02',sku:s.items[2].sku,qty:'6',poNumber:''}]}
function allocations(s,items=s.items.slice(0,3),stores=s.stores.slice(0,2),amount=2){return items.map(item=>({sku:item.sku,available:available(s,item.sku),totalSOQ:100,lines:stores.map(st=>{const key=`${st.storeId}_${item.sku}`,c=s.classification[key].class,ss=s.safety[`${st.storeId}_${c}`];return {...calculateSOQ({sku:item.sku,storeId:st.storeId,dad:s.demand[key].dad,itemClass:c,oc:st.orderCycleDays,lt:st.leadTimeDays,ssd:ss.ssDemandDays,sslt:ss.ssLeadTimeDays,oh:s.oh[key],od:s.od[key]}),allocatedQty:amount,isManualOverride:false,overrideReason:''}})}))}
function withAllocation(){const s=seed();saveAllocation(s,allocations(s),'FAIR_SHARE_COVERAGE',true,inbound,'2026-09-06');return s}
const mutate=(s,fn)=>applyMutation(s,fn);
test('One phase-1 cycle: file → physical koli → checking → item putaway → store batches → partial-ready packing → shipping',()=>{
 let s=seed();s.stock=[];let id,batchId;
 s=mutate(s,d=>{id=importPackingList(d,parseCSV(csv(manifest(d))),'packing-list.csv',inbound)[0]});assert.equal(s.packingLists.length,1);assert.equal(s.kolis.filter(k=>k.internalResiNo===id).length,2);assert.equal(s.stock.length,0);
 const ks=s.kolis.filter(k=>k.internalResiNo===id);
 assert.throws(()=>mutate(s,d=>scanItem(d,ks[0].koliNo,ks[0].expectedItems[0].sku,'PO-A',1,'GOOD')),/penerimaan/);
 s=mutate(s,d=>startWork(d,'RECEIVING',id,inbound));s=mutate(s,d=>receiveKoli(d,id,'V-K01',inbound));
 assert.throws(()=>mutate(s,d=>confirmKoliIntake(d,id,inbound)),/seluruh/);
 assert.throws(()=>mutate(s,d=>receiveKoli(d,id,'V-K01',inbound)),/sudah diterima/);
 assert.equal(s.workEvents.length,1);
 s=mutate(s,d=>receiveKoli(d,id,'V-K02',inbound));s=mutate(s,d=>confirmKoliIntake(d,id,inbound));assert.equal(s.receipts[0].status,'READY_TO_CHECK');
 for(const k of ks){s=mutate(s,d=>beginKoliCart(d,k.koliNo,'KRT-01',inbound));for(const l of k.expectedItems){s=mutate(s,d=>checkKoliItem(d,k.koliNo,l.sku,l.poNumber,1,'GOOD',inbound,'KRT-01'));s=mutate(s,d=>checkKoliItem(d,k.koliNo,l.sku,l.poNumber,l.qtyExpected-1,'GOOD',inbound,'KRT-01'))}s=mutate(s,d=>finishKoliCheck(d,k.koliNo,{},inbound))}
 assert.equal(s.receipts[0].status,'CLOSED');assert.equal(s.stock.reduce((n,r)=>n+r.qty,0),24);
 s=mutate(s,d=>startWork(d,'PUTAWAY','STAGING',inbound));for(const [i,item] of s.items.slice(0,3).entries())s=mutate(s,d=>putawayItem(d,{sku:item.sku,cartNo:'KRT-01',from:'S01-1-01',to:item.primaryLocation,qty:[10,8,6][i]},inbound));s=mutate(s,d=>stopWork(d,d.workSessions.find(w=>w.status==='RUNNING').id,inbound,true));
 assert.equal(s.stock.filter(r=>r.locationCode[0]==='S').reduce((n,r)=>n+r.qty,0),0);assert.equal(physical(s,s.items[0].sku),10);
 s=mutate(s,d=>saveAllocation(d,allocations(d),'FAIR_SHARE_COVERAGE',true,inbound,'2026-09-06'));
 s=mutate(s,d=>{batchId=createPickBatch(d,{pickIds:d.picks.map(p=>p.id),assigneeId:outbound,startLocation:'A01-1-02'},inbound)});
 let b=s.pickBatches[0];assert.equal(b.tasks[0].location,'A01-1-01');assert.deepEqual(b.tasks.map(t=>t.storeId),['ST01','ST01','ST01','ST02','ST02','ST02']);
 s=mutate(s,d=>startWork(d,'PICKING',batchId,outbound));const first=b.tasks[0];
 s=mutate(s,d=>pickBatchItem(d,batchId,first.id,{sku:first.sku,location:first.location,qty:first.qty},outbound));
 const p=s.picks.find(p=>p.id===first.pickId);assert.equal(p.status,'PICKING');
 s=mutate(s,d=>startWork(d,'PACKING',p.id,inbound));s=mutate(s,d=>packFinishedItem(d,p.id,first.sku,first.qty,inbound));
 assert.throws(()=>mutate(s,d=>packFinishedItem(d,p.id,p.lines.find(l=>l.sku!==first.sku).sku,1,inbound)),/Picking finish/);
 assert.throws(()=>mutate(s,d=>sealPacking(d,p.id,inbound)),/Scan ulang/);
 s=mutate(s,d=>stopWork(d,d.workSessions.find(w=>w.userId===inbound&&w.status==='RUNNING').id,inbound,true));
 for(const task of b.tasks.slice(1))s=mutate(s,d=>pickBatchItem(d,batchId,task.id,{sku:task.sku,location:task.location,qty:task.qty},outbound));
 assert.equal(s.pickBatches[0].status,'FINISHED');assert(s.picks.every(p=>p.status==='PICKED'));assert.equal(physical(s,s.items[0].sku),10);assert.equal(reserved(s,s.items[0].sku),4);
 for(const p of s.picks){s=mutate(s,d=>startWork(d,'PACKING',p.id,inbound));for(const l of p.lines)if(l.qty>l.packedQty)s=mutate(s,d=>packFinishedItem(d,p.id,l.sku,l.qty-l.packedQty,inbound));s=mutate(s,d=>sealPacking(d,p.id,inbound))}
 assert.equal(s.orders.length,2);s=mutate(s,d=>startWork(d,'SHIPPING','DISPATCH',outbound));for(const o of s.orders)s=mutate(s,d=>shipWithWork(d,o.doNumber,outbound));assert(s.picks.every(p=>p.status==='SHIPPED'));assert(s.orders.every(o=>o.status==='SHIPPED'));
 assert.equal(physical(s,s.items[0].sku),6);assert.equal(reserved(s,s.items[0].sku),0);assert.equal(available(s,s.items[0].sku),6);assert.equal(s.od[`ST01_${s.items[0].sku}`],14);
 const reports=processHistory(s);assert.deepEqual(['packing_lists','receiving','checking','putaway','picking','packing','shipping'].map(type=>reports[type].length),[1,2,2,3,1,2,2]);assert.equal(reports.shipping.reduce((n,r)=>n+r.qty,0),12);assert.equal(reports.putaway.reduce((n,r)=>n+r.qty,0),24);
 assert.equal(s.queue.filter(q=>q.event==='TRANSFER_STOCK').length,6);assert(s.queue.every(q=>q.status==='WAITING_CONFIGURATION'));
 const metrics=productivity(s,{end:Date.now()+1000});assert.equal(metrics.teams.find(r=>r.process==='RECEIVING').qty,2);assert.equal(metrics.teams.find(r=>r.process==='RECEIVING').lines,3);assert.equal(metrics.teams.find(r=>r.process==='CHECKING').qty,24);assert.equal(metrics.teams.find(r=>r.process==='CHECKING').lines,3);assert.equal(metrics.people.find(r=>r.process==='PICKING').qty,12);assert.equal(metrics.people.find(r=>r.process==='PACKING').qty,12);assert.equal(metrics.people.find(r=>r.process==='SHIPPING').qty,12);
});
test('Packing list validation is atomic for unknown SKUs, bad qty, duplicates and inconsistent koli totals',()=>{
 const s=seed(),original=structuredClone(s),valid=manifest(s);assert.equal(validatePackingList(s,valid).errors.length,0);
 for(const change of [r=>r[0].qty='1.5',r=>r[0].qty='0',r=>r[0].sku='UNKNOWN',r=>r[0].vendorName='Other',r=>r[0].totalKoli='3',r=>r.push({...r[0]}),r=>r[0].shippingDate='2026-02-31']){const rows=structuredClone(valid);change(rows);assert(validatePackingList(s,rows).errors.length);assert.throws(()=>mutate(s,d=>importPackingList(d,rows,'bad.csv',inbound)));assert.deepEqual(s,original)}
 const next=mutate(s,d=>importPackingList(d,valid,'good.csv',inbound));assert.throws(()=>mutate(next,d=>importPackingList(d,valid,'repeat.csv',inbound)),/sudah diimpor/);
});
test('Physical intake never changes item stock and rejects another shipment koli',()=>{
 let s=seed(),id;s=mutate(s,d=>{id=importPackingList(d,manifest(d),'test.csv',inbound)[0]});const before=structuredClone(s.stock);s=mutate(s,d=>startWork(d,'RECEIVING',id,inbound));assert.throws(()=>mutate(s,d=>receiveKoli(d,id,d.kolis[0].koliNo,inbound)),/tidak cocok/);s=mutate(s,d=>receiveKoli(d,id,'V-K01',inbound));assert.deepEqual(s.stock,before);const koli=s.kolis.find(k=>k.internalResiNo===id);assert.throws(()=>mutate(s,d=>closeKoli(d,koli.koliNo,{},inbound)),/penerimaan/);
});
test('Batch route splits stock across locations and protects holds from other batches',()=>{
 const s=withAllocation(),sku=s.items[0].sku;s.stock=s.stock.filter(r=>r.sku!==sku);s.stock.push({sku,locationCode:'A01-1-01',qty:1},{sku,locationCode:'A01-1-02',qty:3});
 const id=createPickBatch(s,{pickIds:s.picks.map(p=>p.id),assigneeId:outbound,startLocation:'A01-1-01'},inbound),b=s.pickBatches[0];assert.equal(b.tasks.filter(t=>t.sku===sku).reduce((n,t)=>n+t.qty,0),4);assert.equal(b.tasks.find(t=>t.sku===sku).qty,1);
 assert.throws(()=>createPickBatch(s,{pickIds:[s.picks[0].id],assigneeId:outbound,startLocation:'A01-1-01'},inbound),/sudah masuk batch/);
 const before=structuredClone(s);assert.throws(()=>mutate(s,d=>pickBatchItem(d,id,b.tasks[0].id,{sku:b.tasks[0].sku,location:b.tasks[0].location,qty:1},inbound)),/operator/);assert.deepEqual(s,before);
 startWork(s,'PICKING',id,outbound);assert.throws(()=>mutate(s,d=>pickBatchItem(d,id,b.tasks[0].id,{sku:b.tasks[0].sku,location:'B01-1-01',qty:1},outbound)),/tidak cocok/);
 const first=b.tasks[0];pickBatchItem(s,id,first.id,{sku:first.sku,location:first.location,qty:first.qty},outbound);assert.throws(()=>mutate(s,d=>pickBatchItem(d,id,first.id,{sku:first.sku,location:first.location,qty:1},outbound)),/tidak cocok/);
 replanBatch(s,id,outbound);assert.equal(b.tasks.filter(t=>t.pickedQty===0&&t.sku===sku).reduce((n,t)=>n+t.qty,0),3);assert(locationDistance('A01-1-01','A01-1-02')<locationDistance('A01-1-01','A02-1-01'));
});
test('Short-pick releases batch tasks and stock reservations; cancellation releases holds',()=>{
 const s=withAllocation(),p=s.picks[0],id=createPickBatch(s,{pickIds:[p.id],assigneeId:outbound,startLocation:'A01-1-01'},inbound);startWork(s,'PICKING',id,outbound);shortBatchItem(s,id,p.id,p.lines[0].sku,'Barang tidak ditemukan',outbound);assert.equal(p.lines[0].qty,0);assert(s.pickBatches[0].tasks.filter(t=>t.sku===p.lines[0].sku).every(t=>t.qty===t.pickedQty));assert.equal(s.counts[0].status,'PRIORITY');cancelBatch(s,id,'Tunda',outbound);assert.equal(s.pickBatches[0].status,'CANCELLED');assert.equal(p.status,'CANCELLED');
});
test('Work timing excludes pauses, sums team labor hours and deduplicates repeated lines',()=>{
 const s=seed();s.workers.push({id:'SECOND',name:'Operator 2',teamId:'INBOUND',active:true});const t=n=>new Date(Date.UTC(2026,8,6,8,n)).toISOString();
 const id=startWork(s,'CHECKING','K1',inbound,t(0));recordWork(s,'CHECKING','K1',inbound,{qty:10,lineKeys:['SKU1']},t(10));stopWork(s,id,inbound,false,t(30));
 assert.throws(()=>recordWork(s,'CHECKING','K1',inbound,{qty:1,lineKeys:['SKU1']},t(40)),/Mulai/);
 startWork(s,'CHECKING','K1',inbound,t(60));recordWork(s,'CHECKING','K1',inbound,{qty:5,lineKeys:['SKU1']},t(70));stopWork(s,id,inbound,true,t(90));
 const two=startWork(s,'CHECKING','K1','SECOND',t(0));recordWork(s,'CHECKING','K1','SECOND',{qty:5,lineKeys:['SKU1']},t(20));stopWork(s,two,'SECOND',true,t(60));
 const result=productivity(s,{start:Date.parse(t(0)),end:Date.parse(t(120))}),person=result.people.find(r=>r.userId===inbound),team=result.teams[0];assert.equal(person.hours,1);assert.equal(person.lines,1);assert.equal(person.qtyPerHour,15);assert.equal(team.hours,2);assert.equal(team.qtyPerHour,10);assert.equal(team.lines,1);assert.equal(team.linesPerHour,.5);
 const clip=productivity(s,{start:Date.parse(t(60)),end:Date.parse(t(90)),userId:inbound});assert.equal(clip.people[0].hours,.5);assert.equal(clip.people[0].qty,5);assert.equal(clip.people[0].qtyPerHour,10);
});
test('An operator cannot run overlapping work or change teams mid-session',()=>{
 const s=seed();startWork(s,'PUTAWAY','STAGING',inbound);assert.throws(()=>startWork(s,'PACKING','P1',inbound),/Jeda/);assert.throws(()=>saveWorker(s,{id:inbound,name:'New name',teamId:'OUTBOUND',active:true}),/Selesaikan/);assert.throws(()=>mutate(s,d=>putawayItem(d,{sku:d.items[0].sku,from:'S01-1-01',to:'A01-1-01',qty:1},outbound)),/Mulai/);assert.equal(productivity(s).people[0]?.qtyPerHour??null,null);
});
test('Additive migration preserves historical stock and documents, without inventing productivity',()=>{
 const s=seed(),stock=structuredClone(s.stock),k=s.kolis[0];delete s.phase1Version;delete s.workEvents;delete s.workSessions;delete s.workers;delete s.teams;delete s.pickBatches;delete s.packingLists;k.scannedItems=[{sku:s.items[0].sku,poNumber:'PO-2609-001',qtyScanned:1,condition:'GOOD'}];migrateState(s);assert.deepEqual(s.stock,stock);assert(k.arrivedAt);assert(s.receipts[0].intakeConfirmedAt);assert.equal(s.workEvents.length,0);assert.equal(productivity(s).people.length,0);assert.deepEqual(migrateState(structuredClone(s)),s);
});
test('Concurrent batches hold different physical stock and cannot steal a planned task',()=>{
 const s=withAllocation(),sku=s.items[0].sku;s.stock=s.stock.filter(r=>r.sku!==sku);s.stock.push({sku,locationCode:'A01-1-01',qty:2},{sku,locationCode:'B01-1-01',qty:2});
 const ids=s.picks.map(p=>p.id);const a=createPickBatch(s,{pickIds:[ids[0]],assigneeId:outbound,startLocation:'A01-1-01'},inbound);const b=createPickBatch(s,{pickIds:[ids[1]],assigneeId:inbound,startLocation:'A01-1-01'},inbound);
 const ta=s.pickBatches.find(x=>x.id===a).tasks.find(t=>t.sku===sku),tb=s.pickBatches.find(x=>x.id===b).tasks.find(t=>t.sku===sku);assert.equal(ta.location,'A01-1-01');assert.equal(tb.location,'B01-1-01');
 assert.throws(()=>mutate(s,d=>pickItem(d,ids[1],{sku,location:ta.location,qty:1},inbound)),/tugas/);
 startWork(s,'PICKING',a,outbound);pickBatchItem(s,a,ta.id,{sku,location:ta.location,qty:2},outbound);assert.equal(s.picks.find(p=>p.id===ids[1]).lines.find(l=>l.sku===sku).pickedQty,0);
});
test('Packing-list CSV cannot silently replace values through duplicate column names',()=>{assert.throws(()=>parseCSV('sku,qty,qty\nB01-106A2,2,99\n'),/kolom file duplikat/)});
