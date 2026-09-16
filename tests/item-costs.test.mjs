import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyMutation,migrateState} from '../src/lib/data.js';
import {createTestingState,generateTestingResi,TEST_DATASET_ID} from '../src/lib/testing-data.js';
import {parseItemCost} from '../src/lib/item-costs.js';
import {packingColumns,importPackingList,validatePackingList} from '../src/lib/phase1.js';
import {applyResiSnapshot} from '../src/lib/integration.js';
import {createIntegrationGateway} from '../server/integration-gateway.js';
import {makeBackup,validateBackup} from '../portable/backup-core.js';
import {csv,parseCSV} from '../src/lib/files.js';
const make=()=>createTestingState(seed());
test('Cost decimal parsing preserves cents, accepts zero/missing, and rejects ambiguous or invalid input',()=>{
 for(const value of ['12500.50','12500,50',12500.5])assert.deepEqual(parseItemCost(value),{hppPerItem:12500.5,hppMinor:1250050,currency:'IDR'});
 assert.equal(parseItemCost('0').hppMinor,0);for(const value of ['',null,undefined])assert.equal(parseItemCost(value),null);
 for(const value of ['-1','1e4','NaN','Infinity','12.500','12,500.00','Rp 100',9007199254740991])assert.throws(()=>parseItemCost(value));
 assert.deepEqual(packingColumns,['vendorName','shippingDate','externalResiNo','expedition','totalKoli','vendorKoliNo','poNumber','sku','qty','hpp/item']);
});
test('Receipt costs persist per source line and in backup; metadata never changes stock or defaults missing to zero',async()=>{
 let s=make();const pack=generateTestingResi(s),rows=parseCSV(csv(pack.rows));rows[0]['hpp/item']='12500,50';rows[1]['hpp/item']='0';delete rows[2]['hpp/item'];
 s=applyMutation(s,d=>importPackingList(d,rows,pack.filename,'OP-IN-01'));
 assert.equal(s.receiptItemCosts.length,20);assert.equal(s.receiptItemCosts[0].hppMinor,1250050);assert.equal(s.receiptItemCosts[1].hppMinor,0);assert.equal(s.receiptItemCosts[2].hppMinor,null);assert.equal(s.stock.length,0);
 const e=s.queue.find(e=>e.event==='RECEIPT_ITEM_COSTS');assert.equal(e.target,'MOKA');assert.equal(e.payload.metadataOnly,true);assert.equal(e.status,'WAITING_CONFIGURATION');assert.deepEqual(e.payload.lines,s.receiptItemCosts);
 const next=migrateState(JSON.parse(JSON.stringify(s)));assert.deepEqual(next.receiptItemCosts,s.receiptItemCosts);assert.equal(next.testing.id,TEST_DATASET_ID);
 const restored=(await validateBackup(await makeBackup(s))).state;assert.deepEqual(restored.receiptItemCosts,s.receiptItemCosts);
 const other=rows.map(r=>({...r,externalResiNo:'SECOND-COST','hpp/item':'20000'}));importPackingList(s,other,'second.csv','OP-IN-01');assert.equal(s.receiptItemCosts[0].hppMinor,1250050);assert.equal(s.receiptItemCosts[20].hppMinor,2000000);
});
test('Invalid costs reject whole import; changed ERP costs do not silently overwrite previously captured data',()=>{
 const s=make(),rows=generateTestingResi(s).rows,snapshot={snapshotId:'cost-1',rows},before=structuredClone(s);
 const bad=structuredClone(rows);bad[19]['hpp/item']='-10';assert(validatePackingList(s,bad).errors.some(e=>e.includes('hpp/item')));assert.throws(()=>importPackingList(s,bad,'bad.csv','OP-IN-01'));assert.deepEqual(s,before);
 const next=applyMutation(s,d=>applyResiSnapshot(d,snapshot,'OP-IN-01')),again=applyMutation(next,d=>applyResiSnapshot(d,snapshot,'OP-IN-01'));assert.equal(again.receiptItemCosts.length,20);assert.equal(again.queue.length,next.queue.length);
 const changed=structuredClone(snapshot);changed.rows[0]['hpp/item']+=10;assert.throws(()=>applyMutation(next,d=>applyResiSnapshot(d,changed,'OP-IN-01')),/berubah/);
});
test('Mini ERP gateway retains hpp/item while approved outbox contract carries cost metadata unchanged',async()=>{
 const s=make(),rows=generateTestingResi(s).rows,seen=[];
 const gateway=createIntegrationGateway(async(url,options)=>{seen.push(JSON.parse(options.body));return new Response(JSON.stringify(String(url).includes('resi_rpc')?{rows,snapshotId:'cost',truncated:false,totalRows:rows.length}:{id:'cost-event',status:'QUEUED'}),{status:200})});
 const env={WMS_INTEGRATION_ENABLED:'true',SUPABASE_URL:'https://testing.supabase.co',SUPABASE_SERVER_KEY:'test',MINI_ERP_RESI_RPC:'resi_rpc',WMS_OUTBOX_RPC:'outbox_rpc',WMS_ALLOW_EVENT_SUBMIT:'true'};
 const res=await gateway(new Request('https://wms.test/api/integrations/resi'),env);assert.equal(res.status,200);assert.equal((await res.json()).rows[0]['hpp/item'],rows[0]['hpp/item']);
 const event={id:'cost-event',target:'MOKA',event:'RECEIPT_ITEM_COSTS',payload:{metadataOnly:true,lines:[{hppMinor:12345,hppPerItem:123.45}]}};
 const submitted=await gateway(new Request('https://wms.test/api/integrations/outbox',{method:'POST',body:JSON.stringify({action:'submit',event})}),env);assert.equal(submitted.status,200);assert.deepEqual(seen.at(-1).p_event.payload,event.payload);
});
