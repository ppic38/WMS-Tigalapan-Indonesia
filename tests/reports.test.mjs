import test from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../src/lib/data.js';
import {receivingQueues} from '../src/lib/receiving-queues.js';
import {processHistory,filterHistory,reportDay} from '../src/lib/reports.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck} from '../src/lib/phase1.js';
import {startWork} from '../src/lib/productivity.js';
import {approve} from '../src/lib/actions.js';
const user='OP-IN-01';
function fixture(){
 const s=seed();s.receipts=[];s.kolis=[];s.stock=[];
 const rows=['KOLI-01','KOLI-02'].map((vendorKoliNo,i)=>({packingListNo:'PL-HISTORY',vendorName:'Vendor History',externalResiNo:'RESI-HISTORY',expedition:'Uji',totalKoli:2,vendorKoliNo,poNumber:'PO-HISTORY',sku:s.items[i].sku,qty:2}));
 const id=importPackingList(s,rows,'history.csv',user)[0];return {s,id,a:s.kolis[0],b:s.kolis[1]};
}
test('Completed intake rows leave Receiving immediately and remain in history while final confirmation stays actionable',()=>{
 const {s,id,a,b}=fixture();
 assert.equal(receivingQueues(s).pendingKolis.length,2);assert.equal(processHistory(s).packing_lists.length,1);
 startWork(s,'RECEIVING',id,user);receiveKoli(s,id,a.koliNo,user);
 assert.deepEqual(receivingQueues(s).pendingKolis.map(k=>k.koliNo),[b.koliNo]);assert.equal(processHistory(s).receiving[0].document,'KOLI-01');assert.equal(receivingQueues(s).checking.length,0);
 receiveKoli(s,id,b.koliNo,user);
 assert.equal(receivingQueues(s).pendingKolis.length,0);assert.equal(receivingQueues(s).confirmations.length,1);assert.equal(receivingQueues(s).count,1);assert.equal(processHistory(s).receiving.length,2);
 confirmKoliIntake(s,id,user);
 assert.equal(receivingQueues(s).intakes.length,0);assert.equal(receivingQueues(s).checking.length,2);assert.equal(receivingQueues(s).count,2);
 assert(processHistory(s).receiving.every(r=>r.status==='Diterima · kiriman dikonfirmasi'));
});
test('Completed and discrepant checking leaves operational queues without deleting SKU, cart, receipt or approval history',()=>{
 const {s,id,a,b}=fixture();startWork(s,'RECEIVING',id,user);for(const k of [a,b])receiveKoli(s,id,k.koliNo,user);confirmKoliIntake(s,id,user);
 for(const [i,k] of [a,b].entries()){
  beginKoliCart(s,k.koliNo,'KRT-HISTORY',user);checkKoliItem(s,k.koliNo,s.items[i].sku,'',2,i?'DAMAGED':'GOOD',user,'KRT-HISTORY');
  finishKoliCheck(s,k.koliNo,i?{[`${s.items[i].sku}|PO-HISTORY`]:'DAMAGED_IN_TRANSIT'}:{},user);
 }
 assert.deepEqual(receivingQueues(s),{intakes:[],pendingKolis:[],confirmations:[],checking:[],count:0});
 assert.equal(s.receipts.length,1);assert.equal(s.kolis.length,2);assert.equal(s.packingLists.length,1);assert.equal(s.approvals.length,1);
 const history=processHistory(s);assert.equal(history.checking.length,2);assert.equal(history.receiving.length,2);assert.equal(history.checking.reduce((n,r)=>n+r.qty,0),4);
 assert.equal(filterHistory(history.checking,{query:'KRT-HISTORY'}).length,2);assert.equal(filterHistory(history.packing_lists,{query:s.items[0].sku}).length,1);
 assert(history.checking.find(r=>r.id===b.koliNo).status.includes('menunggu spv'));
 approve(s,s.approvals[0].id,'SPV',true,'Hasil diperiksa',user);approve(s,s.approvals[0].id,'MANAGER',true,'Setuju fisik',user);
 assert.equal(receivingQueues(s).count,0);assert.equal(processHistory(s).checking.find(r=>r.id===b.koliNo).qty,2);assert.equal(processHistory(s).approvals.length,2);
 assert(processHistory(s).checking.find(r=>r.id===b.koliNo).status.includes('disetujui'));
 const before=structuredClone(s);processHistory(s);assert.deepEqual(s,before);
});
test('Report date boundaries use WITA, include the whole selected day and keep unknown dates in the unfiltered history',()=>{
 const row=(id,at)=>({key:id,at,document:id,meta:[],rows:[],qty:0});
 const rows=[row('BEFORE','2026-09-06T15:59:59Z'),row('AFTER','2026-09-06T16:00:00Z'),row('UNKNOWN','')];
 assert.equal(reportDay(rows[0].at),'2026-09-06');assert.equal(reportDay(rows[1].at),'2026-09-07');
 assert.deepEqual(filterHistory(rows,{start:'2026-09-06',end:'2026-09-06'}).map(r=>r.key),['BEFORE']);
 assert.deepEqual(filterHistory(rows,{start:'2026-09-07',end:'2026-09-07'}).map(r=>r.key),['AFTER']);
 assert.equal(filterHistory(rows).length,3);assert.equal(filterHistory(rows,{start:'2026-09-07',end:'2026-09-06'}).length,0);
 assert.equal(filterHistory(rows,{query:'unknown'})[0].qty,0);
});
