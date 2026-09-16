import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyMutation,newId,pickedAt,reserved,available,migrateState} from '../src/lib/data.js';
import {createTestingState} from '../src/lib/testing-data.js';
import {saveLocationMapping,mappingValue} from '../src/lib/locations.js';
import {addLayoutLocations,currentWarehouseLayout,saveWarehouseLayout,warehouseUtilization} from '../src/lib/warehouse-layout.js';
import {makeBackup,validateBackup} from '../portable/backup-core.js';
import {openCheckingCart} from '../src/lib/carts.js';
import {startWork,finishWork,productivity} from '../src/lib/productivity.js';
import {processHistory} from '../src/lib/reports.js';
import {shipWithWork} from '../src/lib/phase1.js';
import {pickItem,packItem} from '../src/lib/actions.js';
import {previewCapacityBatches,createCapacityBatches,splitReadyBatch,scanPickingCart,claimPickBatch,pickCartBatchItem,shortCartBatchTask,replanCartBatch,cancelCapacityBatch,releasePickingCart,activePickingCart,pickingCartInfo,outboundCartQty,packingCartRows,openPackingKoli,packCartIntoKoli,sealPackingKoli,cancelEmptyPackingKoli,routingDistance,batchCandidates} from '../src/lib/outbound.js';
const user='OP-OUT-01',other='OP-IN-01',admin='USER-ADMIN';
export function fixture(){
 const s=seed(),[a,b]=s.items;s.stock=[{sku:a.sku,locationCode:'A01-1-01',qty:80},{sku:a.sku,locationCode:'A02-1-01',qty:40},{sku:b.sku,locationCode:'A01-1-02',qty:60}];
 s.allocations=[{allocationNo:'AL-TEST',status:'CONFIRMED',createdAt:new Date().toISOString(),lines:[{sku:a.sku,storeId:'ST01',allocatedQty:75},{sku:b.sku,storeId:'ST01',allocatedQty:25},{sku:a.sku,storeId:'ST02',allocatedQty:25},{sku:b.sku,storeId:'ST02',allocatedQty:15}]}];
 s.picks=['ST01','ST02'].map((storeId,i)=>({id:'P'+i,storeId,allocationNo:'AL-TEST',status:'READY',lines:s.allocations[0].lines.filter(l=>l.storeId===storeId).map(l=>({sku:l.sku,qty:l.allocatedQty,pickedQty:0,packedQty:0,sources:[]}))}));return s;
}
const input=(s,capacity=30)=>({pickIds:s.picks.map(p=>p.id),capacity,startLocation:'A01-1-01'});
const pick=(s,b,userId=user)=>{claimPickBatch(s,b.id,userId);for(const t of b.tasks)if(t.qty>t.pickedQty)pickCartBatchItem(s,b.id,t.id,{sku:t.sku,location:t.location,qty:t.qty-t.pickedQty,cartNo:b.cartNo,requestId:newId()},userId);};
const reject=(s,fn,pattern)=>{const before=structuredClone(s);assert.throws(()=>applyMutation(s,fn),pattern);assert.deepEqual(s,before);};

test('Layout creates one or many master locations atomically and preserves SKU ABC and stock',()=>{
 const s=createTestingState(seed()),before=structuredClone(s.stock),classes=s.items.map(i=>i.abcClass),layout=currentWarehouseLayout(s);saveWarehouseLayout(s,{...layout,expectedRevision:0},admin);
 const form={rack:'D01',firstLevel:1,lastLevel:3,firstBin:1,lastBin:4,capacity:200},codes=addLayoutLocations(s,form,admin);assert.equal(codes.length,12);assert.equal(s.locations.find(l=>l.locationCode==='D01-2-03').capacity,200);assert.equal(warehouseUtilization(s).unplaced,1);assert.deepEqual(s.stock,before);assert.deepEqual(s.items.map(i=>i.abcClass),classes);
 reject(s,d=>addLayoutLocations(d,form,admin),/sudah terdaftar/);reject(s,d=>addLayoutLocations(d,{...form,rack:'Q01'},admin),/A–P/);reject(s,d=>addLayoutLocations(d,{...form,rack:'D02',firstLevel:0},admin),/level/);reject(s,d=>addLayoutLocations(d,{...form,rack:'D02',capacity:0},admin),/Kapasitas/);reject(s,d=>addLayoutLocations(d,{...form,rack:'D02'},'USER-OP-IN-01'),/akses/);
 assert(processHistory(s).location_control.some(r=>r.reference==='Tambah lokasi'&&r.qty===12));
 const item=s.items[0],abc=item.abcClass==='A'?'C':'A',f={sku:item.sku,...mappingValue(item),abcClass:abc};reject(s,d=>saveLocationMapping(d,f,admin),/Master SKU/);saveLocationMapping(s,f,admin,'master');assert.equal(item.abcClass,abc);saveLocationMapping(s,{sku:item.sku,primaryLocation:'D01-1-01',reserveLocations:[]},admin);assert.equal(item.abcClass,abc);
});

test('Planner groups Store then nearest location then capacity, splitting one SKU across batches without duplicate holds',()=>{
 const s=fixture(),before=structuredClone(s),plan=previewCapacityBatches(s,input(s));assert.deepEqual(s,before);assert.deepEqual(plan.map(b=>[b.storeId,b.tasks.reduce((n,t)=>n+t.qty,0)]),[['ST01',30],['ST01',30],['ST01',30],['ST01',10],['ST02',30],['ST02',10]]);
 for(const b of plan){assert.equal(new Set(b.tasks.map(t=>t.storeId)).size,1);assert(b.tasks.reduce((n,t)=>n+t.qty,0)<=30);}assert.equal(plan[0].tasks[0].location,'A01-1-01');
 const ids=createCapacityBatches(s,input(s),user);assert.equal(ids.length,6);assert.equal(s.picks[0].batchIds.length,4);assert.equal(batchCandidates(s).length,0);reject(s,d=>createCapacityBatches(d,input(d),user),/Semua qty/);assert(s.pickBatches.every(b=>b.assigneeId===null));
});

test('Nearest location follows valid saved rack coordinates and retains a code-distance fallback',()=>{
 const s=fixture();s.locations=['A01-1-01','A02-1-01','B01-1-01'].map(locationCode=>({locationCode,allocatable:true,active:true,zone:locationCode[0],rack:locationCode.slice(1,3)}));s.stock=[{sku:s.items[0].sku,locationCode:'A02-1-01',qty:5},{sku:s.items[0].sku,locationCode:'B01-1-01',qty:5}];s.picks[0].lines=[{sku:s.items[0].sku,qty:10,pickedQty:0,packedQty:0,sources:[]}];
 const layout={expectedRevision:0,warehouse:{width:30,depth:10},racks:[['A01',0],['A02',20],['B01',2]].map(([id,x])=>({id,x,y:1,width:1,depth:1,height:2,rotation:0}))};saveWarehouseLayout(s,layout,admin);assert.equal(routingDistance(s).mode,'denah tersimpan');const plan=previewCapacityBatches(s,{pickIds:['P0'],capacity:10,startLocation:'A01-1-01'});assert.deepEqual(plan[0].tasks.map(t=>t.location),['B01-1-01','A02-1-01']);
});

test('Scan cart gates claim, enforces capacity, inbound exclusivity and one operator per batch',()=>{
 const s=fixture(),ids=createCapacityBatches(s,input(s),user);reject(s,d=>claimPickBatch(d,ids[0],user),/Scan kereta/);scanPickingCart(s,'KRT-SMALL',user,20);reject(s,d=>claimPickBatch(d,ids[0],user),/Kapasitas/);releasePickingCart(s,user);scanPickingCart(s,'KRT-01',user,60);claimPickBatch(s,ids[0],user);
 reject(s,d=>scanPickingCart(d,'KRT-01',other,60),/operator lain/);scanPickingCart(s,'KRT-02',other,60);reject(s,d=>claimPickBatch(d,ids[0],other),/operator lain/);reject(s,d=>claimPickBatch(d,ids[1],user),/batch aktif/);reject(s,d=>releasePickingCart(d,user),/Selesaikan/);reject(s,d=>openCheckingCart(d,'KRT-01',other),/Picking/);
 s.checkingCarts.push({cartNo:'KRT-INBOUND',status:'OPEN',userId:other});reject(s,d=>scanPickingCart(d,'KRT-INBOUND',other,60),/Lepas|Receiving/);
 const b=s.pickBatches[0],t=b.tasks[0],f={sku:t.sku,location:t.location,qty:10,cartNo:'KRT-01',requestId:newId()};reject(s,d=>pickCartBatchItem(d,b.id,t.id,{...f,sku:s.items[1].sku},user),/Lokasi, SKU/);reject(s,d=>pickCartBatchItem(d,b.id,t.id,{...f,qty:31},user),/Lokasi, SKU/);pickCartBatchItem(s,b.id,t.id,f,user);assert.equal(outboundCartQty(s,b.cartRunId),10);reject(s,d=>pickCartBatchItem(d,b.id,t.id,f,user),/sudah tersimpan/);assert.equal(packingCartRows(s).length,0);
 reject(s,d=>pickItem(d,t.pickId,f,user),/scan kereta/);reject(s,d=>packItem(d,t.pickId,t.sku,1),/koli packing/);
});

test('One koli combines batches and a batch spans kolis; partial shipping conserves stock, reservation, source quantities and cart reuse',()=>{
 const s=fixture();createCapacityBatches(s,input(s),user);scanPickingCart(s,'KRT-MIX',user,120);pick(s,s.pickBatches[0]);pick(s,s.pickBatches[1]);const run=s.pickBatches[0].cartRunId;assert.equal(outboundCartQty(s,run),60);assert.equal(packingCartRows(s).length,2);
 const sku=s.items[0].sku,initialAvailable=available(s,sku),initialReserved=reserved(s,sku);
 openPackingKoli(s,'KO-01','ST01',other);const f={koliNo:'KO-01',cartNo:'KRT-MIX',sku,qty:45,requestId:newId()};packCartIntoKoli(s,f,other);reject(s,d=>packCartIntoKoli(d,f,other),/sudah tersimpan/);assert.equal(s.packingKolis[0].lines.length,2);assert.deepEqual(s.packingKolis[0].lines.map(l=>l.qty),[30,15]);assert.equal(outboundCartQty(s,run),15);
 const order=sealPackingKoli(s,'KO-01',other);startWork(s,'SHIPPING','DISPATCH',user);shipWithWork(s,order,user);assert.equal(reserved(s,sku),initialReserved-45);assert.equal(available(s,sku),initialAvailable);assert.equal(pickedAt(s,sku,'A01-1-01'),15);assert.equal(s.od[`ST01_${sku}`],45+12);reject(s,d=>shipWithWork(d,order,user),/sudah dikirim/);finishWork(s,'SHIPPING','DISPATCH');
 openPackingKoli(s,'KO-02','ST01',other);packCartIntoKoli(s,{...f,koliNo:'KO-02',qty:15,requestId:newId()},other);assert.equal(outboundCartQty(s,run),0);assert.equal(s.pickingCartRuns.find(c=>c.id===run).status,'FINISHED');assert.equal(activePickingCart(s,user),undefined);sealPackingKoli(s,'KO-02',other);
 openCheckingCart(s,'KRT-MIX',user);assert(s.checkingCarts.some(c=>c.cartNo==='KRT-MIX'&&c.status==='OPEN'));
 const history=processHistory(s);assert.equal(history.packing.length,2);assert(history.packing[0].rows.some(r=>r.includes(s.pickBatches[1].id)));assert.equal(history.shipping.length,1);
});

test('Finished goods from other stores and unfinished batches cannot enter a koli; a full cart remains blocked until emptied',()=>{
 const s=fixture();createCapacityBatches(s,input(s),user);scanPickingCart(s,'CART1',user,30);pick(s,s.pickBatches[0]);reject(s,d=>claimPickBatch(d,s.pickBatches[1].id,user),/Kapasitas/);releasePickingCart(s,user);reject(s,d=>scanPickingCart(d,'CART1',other),/operator lain|packing/);
 scanPickingCart(s,'CART2',user,30);pick(s,s.pickBatches[4]);releasePickingCart(s,user);openPackingKoli(s,'KO-STORE1','ST01',other);reject(s,d=>packCartIntoKoli(d,{koliNo:'KO-STORE1',cartNo:'CART2',sku:s.items[0].sku,qty:1,requestId:newId()},other),/store ini/);reject(s,d=>packCartIntoKoli(d,{koliNo:'KO-STORE1',cartNo:'CART1',sku:s.items[0].sku,qty:31,requestId:newId()},other),/Qty melebihi/);reject(s,d=>sealPackingKoli(d,'KO-STORE1',other),/kosong/);cancelEmptyPackingKoli(s,'KO-STORE1',other);
});

test('Short-pick and cancellation only change their own batch; replan does not steal sibling reservations',()=>{
 const s=fixture();createCapacityBatches(s,input(s),user);scanPickingCart(s,'CART1',user,60);const b=s.pickBatches[0],sibling=structuredClone(s.pickBatches[1]),originalReserved=reserved(s,s.items[0].sku);claimPickBatch(s,b.id,user);shortCartBatchTask(s,b.id,b.tasks[0].id,'Tidak ditemukan',user);assert.equal(b.status,'FINISHED');assert.deepEqual(s.pickBatches[1],sibling);assert.equal(reserved(s,s.items[0].sku),originalReserved-30);
 scanPickingCart(s,'CART1',user,60);const next=s.pickBatches[1];claimPickBatch(s,next.id,user);const t=next.tasks[0];pickCartBatchItem(s,next.id,t.id,{sku:t.sku,location:t.location,qty:10,cartNo:'CART1',requestId:newId()},user);replanCartBatch(s,next.id,user);assert.equal(sumQty(next.tasks),30);cancelCapacityBatch(s,next.id,'Barang dikembalikan ke lokasi asal',user);assert.equal(next.status,'CANCELLED');assert.equal(s.picks[0].lines[0].pickedQty,0);assert(batchCandidates(s).some(p=>p.id==='P0'));assert.equal(outboundCartQty(s,next.cartRunId),0);assert.equal(s.counts.length,1);
});
function sumQty(rows){return rows.reduce((n,r)=>n+r.qty,0)}

test('Old V6 backups load with new optional collections; new cart/koli state and current testing progress survive restoration',async()=>{
 const old=createTestingState(seed());for(const k of ['cartMasters','pickingCartRuns','packingKolis'])delete old[k];const restored=await validateBackup(await makeBackup(old));assert.deepEqual(restored.state.cartMasters,[]);
 const s=createTestingState(seed());scanPickingCart(s,'KRT-RESTORE',user,200);s.stock.push({sku:s.items[0].sku,locationCode:s.items[0].primaryLocation,qty:4});const copy=await validateBackup(await makeBackup(s));assert.equal(activePickingCart(copy.state,user).cartNo,'KRT-RESTORE');assert.equal(copy.state.stock[0].qty,4);assert.equal(copy.state.testing.id,s.testing.id);
});

test('A waiting batch can be split for a smaller cart without duplicating or releasing its stock holds',()=>{
 const s=fixture();createCapacityBatches(s,input(s,100),user);const before=reserved(s,s.items[0].sku),parent=s.pickBatches[0],ids=splitReadyBatch(s,parent.id,25,user);assert.equal(ids.length,4);assert.equal(parent.status,'CANCELLED');assert.equal(reserved(s,s.items[0].sku),before);assert.equal(batchCandidates(s).length,0);scanPickingCart(s,'CART-SMALL',user,25);claimPickBatch(s,ids[0],user);reject(s,d=>splitReadyBatch(d,ids[0],10,user),/belum diambil/);assert(pickingCartInfo(s,activePickingCart(s,user)).reserved===25);
});

test('Parallel picking, packing and shipping preserve task balances and reject competing stale packing scans',()=>{
 const s=fixture(),packer='QA-PACK',shipper='QA-SHIP';s.workers.push({id:packer,name:'Packing QA',teamId:'OUTBOUND',active:true},{id:shipper,name:'Shipping QA',teamId:'OUTBOUND',active:true});
 createCapacityBatches(s,input(s),user);scanPickingCart(s,'PAR-A',user,60);scanPickingCart(s,'PAR-B',other,60);
 const [a,b]=s.pickBatches;claimPickBatch(s,a.id,user);claimPickBatch(s,b.id,other);
 const scan=(batch,operator)=>{for(const t of batch.tasks)pickCartBatchItem(s,batch.id,t.id,{sku:t.sku,location:t.location,qty:t.qty,cartNo:batch.cartNo,requestId:newId()},operator)};
 scan(a,user);assert.equal(b.status,'PICKING');openPackingKoli(s,'PAR-K1','ST01',packer);
 const sku=a.tasks[0].sku;packCartIntoKoli(s,{koliNo:'PAR-K1',cartNo:'PAR-A',sku,qty:20,requestId:newId()},packer);
 const order=sealPackingKoli(s,'PAR-K1',packer);startWork(s,'SHIPPING','DISPATCH',shipper);shipWithWork(s,order,shipper);
 assert.equal(b.status,'PICKING');scan(b,other);assert.equal(b.status,'FINISHED');
 openPackingKoli(s,'PAR-K2','ST01',packer);openPackingKoli(s,'PAR-K3','ST01',user);
 packCartIntoKoli(s,{koliNo:'PAR-K2',cartNo:'PAR-A',sku,qty:10,requestId:newId()},packer);
 reject(s,d=>packCartIntoKoli(d,{koliNo:'PAR-K3',cartNo:'PAR-A',sku,qty:10,requestId:newId()},user),/Qty melebihi/);
 packCartIntoKoli(s,{koliNo:'PAR-K3',cartNo:'PAR-B',sku,qty:30,requestId:newId()},user);
 for(const [k,operator] of [['PAR-K2',packer],['PAR-K3',user]]){const id=sealPackingKoli(s,k,operator);shipWithWork(s,id,shipper);reject(s,d=>shipWithWork(d,id,shipper),/sudah dikirim/);}
 assert.equal(s.stock.filter(r=>r.sku===sku).reduce((n,r)=>n+r.qty,0),60);assert.equal(s.allocations[0].lines.find(l=>l.sku===sku&&l.storeId==='ST01').shippedQty,60);
 assert.equal(s.queue.filter(q=>q.event==='TRANSFER_STOCK').reduce((n,q)=>n+q.payload.qty,0),60);assert.equal(pickedAt(s,sku,'A01-1-01'),0);
});
