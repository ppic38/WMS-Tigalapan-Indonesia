import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyMutation,migrateState,move} from '../src/lib/data.js';
import {createTestingState,prepareTestingState} from '../src/lib/testing-data.js';
import {defaultWarehouseLayout,currentWarehouseLayout,storageRacks,layoutIssues,moveRack,rackFootprint,rackPoint,saveWarehouseLayout,warehouseUtilization} from '../src/lib/warehouse-layout.js';
import {makeBackup,validateBackup} from '../portable/backup-core.js';
import {processHistory} from '../src/lib/reports.js';
const make=()=>createTestingState(seed()),admin='USER-ADMIN';
const input=s=>({...defaultWarehouseLayout(s),expectedRevision:s.warehouseLayout?.revision||0});

test('Actual rack coordinates and rotation persist across migration/backup; relayout does not change warehouse transactions',async()=>{
 const s=make(),before=structuredClone(s),f=input(s);
 assert.equal(currentWarehouseLayout(s).configured,false);assert.equal(warehouseUtilization(s).areaPercent,null);assert.deepEqual(s,before);
 f.warehouse={width:30,depth:20};Object.assign(f.racks[0],{x:18,y:12,width:4,depth:1.5,height:3,rotation:90});
 const saved=applyMutation(s,d=>saveWarehouseLayout(d,f,admin));
 for(const key of ['stock','items','kolis','receipts','queue','movements','checkingCarts','picks'])assert.deepEqual(saved[key],s[key]);
 assert.equal(saved.warehouseLayout.revision,1);assert.equal(currentWarehouseLayout(saved).racks[0].rotation,90);
 assert.equal(warehouseUtilization(saved).floorArea,600);
 const area=f.racks.reduce((n,r)=>n+r.width*r.depth,0);assert.equal(warehouseUtilization(saved).areaPercent,area/600*100);
 assert.deepEqual(rackFootprint(saved.warehouseLayout.racks[0]),{x:18,y:12,width:1.5,depth:4});
 assert.deepEqual(rackPoint(saved.warehouseLayout.racks[0],[0,0,0]),[19.5,12,0]);
 const migrated=migrateState(JSON.parse(JSON.stringify(saved)));assert.deepEqual(migrated.warehouseLayout,saved.warehouseLayout);
 assert.equal(prepareTestingState(migrated,seed),migrated);
 const restored=await validateBackup(await makeBackup(saved));assert.deepEqual(restored.state.warehouseLayout,saved.warehouseLayout);
 const history=processHistory(saved).location_control[0];assert.equal(history.reference,'Layout gudang');assert(history.rows.some(r=>r[0]==='Rak A01'&&r[2].includes('90°')));
});

test('Layout saving rejects overlapping, outside, stale, malformed and unauthorized edits atomically',()=>{
 const s=make(),f=input(s),reject=(payload,pattern,user=admin)=>{const before=structuredClone(s);assert.throws(()=>applyMutation(s,d=>saveWarehouseLayout(d,payload,user)),pattern);assert.deepEqual(s,before)};
 for(const bad of [x=>x.racks[1].x=x.racks[0].x,x=>x.racks[0].x=1000,x=>x.racks[0].width='',x=>x.racks[0].height=-1,x=>x.racks[0].rotation=45,x=>x.warehouse.width=0,x=>x.warehouse.depth=Infinity,x=>x.racks.push({...x.racks[0]}),x=>x.racks.pop()]){const altered=structuredClone(f);bad(altered);reject(altered,/bertumpuk|luar|isi|Isi|duplikat|berubah/)}
 reject(f,/akses/,'USER-OP-IN-01');
 const first=applyMutation(s,d=>saveWarehouseLayout(d,f,admin));
 assert.throws(()=>applyMutation(first,d=>saveWarehouseLayout(d,f,admin)),/Layout berubah/);
 const next={...currentWarehouseLayout(first),expectedRevision:1};next.racks[0].rotation=180;
 const changed=applyMutation(first,d=>saveWarehouseLayout(d,next,admin));assert.equal(changed.warehouseLayout.revision,2);
});

test('Movement snaps to 10 cm, obeys rotated bounds, supports every rack orientation and detects rotated overlap',()=>{
 const s=make(),f=input(s),id=f.racks[0].id;
 let moved=moveRack(f,id,2.17,2.24);assert.equal(moved.racks[0].x,2.2);assert.equal(moved.racks[0].y,2.2);assert.equal(f.racks[0].x,1);
 moved.racks[0].rotation=90;moved=moveRack(moved,id,999,999);const bounds=rackFootprint(moved.racks[0]);assert(bounds.x+bounds.width<=f.warehouse.width);assert(bounds.y+bounds.depth<=f.warehouse.depth);
 const rack={x:2,y:3,width:4,depth:1,height:2};
 for(const rotation of [0,90,180,270]){
  const rotated={...rack,rotation},box=rackFootprint(rotated);
  for(const x of [0,4])for(const y of [0,1]){const p=rackPoint(rotated,[x,y,2]);assert(p[0]>=box.x&&p[0]<=box.x+box.width);assert(p[1]>=box.y&&p[1]<=box.y+box.depth);assert.equal(p[2],2)}
 }
 const overlap={warehouse:{width:10,depth:10},racks:[{...rack,id:'A01',rotation:90},{...rack,id:'B01',x:2,y:5,rotation:0}]};
 assert(layoutIssues(overlap).some(i=>i.message.includes('bertumpuk')));
});

test('New rack masters do not silently alter saved actual dimensions or publish an incomplete area percentage',()=>{
 let s=make();s=applyMutation(s,d=>saveWarehouseLayout(d,input(d),admin));const measured=s.warehouseLayout.warehouse;
 s.locations.push({locationCode:'D01-1-01',zone:'D',rack:'01',level:'1',bin:'01',allocatable:true,active:true,capacity:100});
 const layout=currentWarehouseLayout(s);assert.deepEqual(layout.warehouse,measured);assert.deepEqual(layout.unplaced,['D01']);assert.equal(warehouseUtilization(s).areaPercent,null);
 assert.equal(storageRacks(s).length,7);
 const next={...layout,warehouse:{width:40,depth:25},expectedRevision:1};Object.assign(next.racks.find(r=>r.id==='D01'),{x:30,y:20});
 s=applyMutation(s,d=>saveWarehouseLayout(d,next,admin));assert.equal(currentWarehouseLayout(s).unplaced.length,0);assert.notEqual(warehouseUtilization(s).areaPercent,null);
});

test('Utilization counts occupied locations once, excludes special/inactive storage, and exposes unknown capacity',()=>{
 let s=make();const [a,b]=s.items,loc=a.primaryLocation,empty=warehouseUtilization(s);assert.equal(empty.locationPercent,0);assert.equal(empty.capacityPercent,0);assert.equal(empty.areaPercent,null);
 s.stock.push({sku:a.sku,locationCode:'S01-1-01',qty:40},{sku:a.sku,locationCode:'Q01-1-01',qty:500});
 assert.equal(warehouseUtilization(s).used,0);
 s=applyMutation(s,d=>move(d,a.sku,20,'S01-1-01',loc,'PUTAWAY','QA','QA'));
 s.stock.push({sku:b.sku,locationCode:loc,qty:10});let u=warehouseUtilization(s);assert.equal(u.occupied,1);assert.equal(u.used,30);assert.equal(u.locationPercent,100/60);
 s=applyMutation(s,d=>{move(d,a.sku,20,loc,null,'SHIP','QA','QA');move(d,b.sku,10,loc,null,'SHIP','QA','QA')});assert.equal(warehouseUtilization(s).occupied,0);
 s.locations.find(l=>l.locationCode===loc).capacity=null;s.stock.push({sku:a.sku,locationCode:a.reserveLocations[0],qty:20});
 u=warehouseUtilization(s);assert.equal(u.unknown,1);assert.equal(u.known,59);assert.equal(u.used,20);
 s.locations.find(l=>l.locationCode===a.reserveLocations[0]).active=false;u=warehouseUtilization(s);assert.equal(u.locations,59);assert.equal(u.used,0);assert.equal(u.occupied,0);
 s.locations=s.locations.filter(l=>!l.allocatable);u=warehouseUtilization(s);assert.equal(u.locationPercent,null);assert.equal(u.capacityPercent,null);
});
