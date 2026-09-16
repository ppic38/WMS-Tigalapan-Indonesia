import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,applyMutation,migrateState} from '../src/lib/data.js';
import {createTestingState,prepareTestingState} from '../src/lib/testing-data.js';
import {addLayoutLocations,storageRacks,rackStructureVersion,planRackStructure,resizeRackStructure,defaultWarehouseLayout,saveWarehouseLayout,currentWarehouseLayout,warehouseUtilization} from '../src/lib/warehouse-layout.js';
import {isStorageLocation,validatePutawayLocation,saveLocationMapping} from '../src/lib/locations.js';
import {makeBackup,validateBackup} from '../portable/backup-core.js';
import {processHistory} from '../src/lib/reports.js';
const admin='USER-ADMIN';
function make(){const s=createTestingState(seed());addLayoutLocations(s,{rack:'D01',firstLevel:1,lastLevel:2,firstBin:1,lastBin:3,capacity:125},admin);return s}
const input=(s,levels=2,bins=3)=>({rack:'D01',levels,bins,capacity:90,expected:rackStructureVersion(s,'D01')});
const unchanged=['items','stock','kolis','receipts','checkingCarts','picks','pickBatches','movements','queue','warehouseLayout'];

test('Resize expands an existing rack, preserves physical layout and inventory, and records all new cells',()=>{
 let s=make();s=applyMutation(s,d=>saveWarehouseLayout(d,{...defaultWarehouseLayout(d),expectedRevision:0},admin));
 const before=structuredClone(s),f=input(s,4,5),preview=planRackStructure(s,f);assert.equal(preview.added.length,14);assert.equal(preview.retired.length,0);assert.deepEqual(s,before);
 const next=applyMutation(s,d=>resizeRackStructure(d,f,admin)),rack=storageRacks(next).find(r=>r.id==='D01');
 assert.equal(rack.cells.length,20);assert.equal(rack.levels.length,4);assert.equal(rack.bins.length,5);
 for(const code of preview.added)assert.equal(next.locations.find(l=>l.locationCode===code).capacity,90);
 for(const l of s.locations)assert.deepEqual(next.locations.find(x=>x.locationCode===l.locationCode),l);
 for(const key of unchanged)assert.deepEqual(next[key],before[key]);
 assert.deepEqual(currentWarehouseLayout(next).racks,currentWarehouseLayout(s).racks);
 assert.equal(warehouseUtilization(next).locations,80);
 const event=processHistory(next).location_control.find(r=>r.reference==='Struktur rak');assert.equal(event.rows.length,14);assert(event.rows.every(r=>r[1]==='Ditambahkan'));
});

test('Shrink retires empty cells, preserves history through backup and migration, and restores the same identifiers',async()=>{
 const s=make(),code='D01-2-03';s.locations.find(l=>l.locationCode===code).capacity=77;
 s.movements.push({movementId:'M-OLD',createdAt:new Date().toISOString(),sku:s.items[0].sku,qty:5,type:'PUTAWAY',fromLocation:'S01-1-01',toLocation:code,refDoc:'PA-OLD',userId:'OP-IN-01'});
 const next=applyMutation(s,d=>resizeRackStructure(d,input(s,1,2),admin));
 assert.equal(next.locations.length,s.locations.length);assert.equal(storageRacks(next).find(r=>r.id==='D01').cells.length,2);assert.equal(warehouseUtilization(next).locations,62);
 const retired=next.locations.find(l=>l.locationCode===code);assert.equal(retired.layoutRetired,true);assert.equal(retired.active,false);assert.equal(retired.capacity,77);assert(!isStorageLocation({...retired,active:true}));
 assert.throws(()=>validatePutawayLocation(next,s.items[0].sku,code,1),/aktif/);
 assert.throws(()=>saveLocationMapping(next,{sku:s.items[0].sku,primaryLocation:code,reserveLocations:[]},admin),/aktif/);
 assert.deepEqual(next.movements,s.movements);assert(processHistory(next).putaway.some(r=>r.rows[0].includes(code)));
 const migrated=migrateState(JSON.parse(JSON.stringify(next)));assert.equal(prepareTestingState(migrated,seed),migrated);
 const restored=(await validateBackup(await makeBackup(migrated))).state;assert.deepEqual(restored.locations,next.locations);
 const enlarged=applyMutation(restored,d=>resizeRackStructure(d,input(restored),admin));assert.equal(enlarged.locations.length,s.locations.length);assert.equal(storageRacks(enlarged).find(r=>r.id==='D01').cells.length,6);
 assert.deepEqual(enlarged.locations,s.locations);assert.deepEqual(enlarged.movements,s.movements);
 assert(processHistory(enlarged).location_control.some(r=>r.reference==='Struktur rak'&&r.rows.every(row=>row[1]==='Dipulihkan')));
});

test('Shrink rejects stock, primary/reserve mappings and active work without mutating anything',()=>{
 const code='D01-2-03';
 const cases=[
  s=>s.stock.push({sku:s.items[0].sku,locationCode:code,qty:1}),
  s=>s.items[0].primaryLocation=code,
  s=>s.items[0].reserveLocations.push(code),
  s=>s.pickBatches.push({id:'B',status:'READY',tasks:[{location:code}]}),
  s=>s.picks.push({id:'P',status:'PICKING',lines:[{sources:[{location:code}]}]}),
  s=>s.orders.push({doNumber:'D',status:'READY',lines:[{sources:[{location:code}]}]}),
  s=>s.counts.push({id:'C',status:'PRIORITY',locationCode:code}),
  s=>s.approvals.push({id:'A',status:'PENDING_MANAGER',locationCode:code}),
  s=>s.returns.push({id:'R',status:'NON_SELLABLE',targetLocation:code})
 ];
 for(const setup of cases){const s=make();setup(s);const before=structuredClone(s),f=input(s,1,2);assert(planRackStructure(s,f).blocked.some(b=>b.code===code));assert.throws(()=>resizeRackStructure(s,f,admin),/masih/);assert.deepEqual(s,before)}
});

test('Finished work and rejected adjustments remain historical references without blocking empty rack edits',()=>{
 const s=make(),code='D01-2-03';
 s.stock.push({sku:s.items[0].sku,locationCode:code,qty:0});
 s.pickBatches.push({id:'B',status:'FINISHED',tasks:[{location:code}]});s.picks.push({id:'P',status:'SHIPPED',lines:[{sources:[{location:code}]}]});s.orders.push({doNumber:'D',status:'SHIPPED',lines:[{sources:[{location:code}]}]});
 s.counts.push({id:'C',status:'PENDING_SPV',locationCode:code});s.approvals.push({id:'A',type:'OPNAME',refDoc:'C',status:'REJECTED'});s.returns.push({id:'R',status:'SELLABLE',targetLocation:code});
 const before=structuredClone(s);assert.equal(planRackStructure(s,input(s,1,2)).blocked.length,0);resizeRackStructure(s,input(s,1,2),admin);
 for(const key of ['stock','pickBatches','picks','orders','counts','approvals','returns'])assert.deepEqual(s[key],before[key]);
});

test('Validation handles bounds, stale structure/capacity, fresh stock changes and authorization atomically',()=>{
 const s=make(),before=structuredClone(s);
 for(const patch of [{levels:0},{levels:10},{levels:1.5},{bins:0},{bins:100},{bins:''},{rack:'Z99'},{levels:3,capacity:0},{levels:3,capacity:1.5}]){assert.throws(()=>resizeRackStructure(s,{...input(s),...patch},admin));assert.deepEqual(s,before)}
 assert.throws(()=>resizeRackStructure(s,input(s,3,3),'USER-OP-IN-01'),/akses/);assert.deepEqual(s,before);
 const f=input(s,3,3);s.locations.find(l=>l.locationCode==='D01-1-01').capacity=99;assert.throws(()=>resizeRackStructure(s,f,admin),/berubah/);
 const fresh=input(s,1,2);s.stock.push({sku:s.items[0].sku,locationCode:'D01-2-03',qty:1});assert.throws(()=>resizeRackStructure(s,fresh,admin),/stok/);
});

test('No-op adds no audit; restoration keeps manually inactive cells inactive',()=>{
 const s=make(),before=structuredClone(s);resizeRackStructure(s,input(s),admin);assert.deepEqual(s,before);
 s.locations.find(l=>l.locationCode==='D01-2-03').active=false;
 resizeRackStructure(s,input(s,1,2),admin);resizeRackStructure(s,input(s),admin);
 assert.equal(s.locations.find(l=>l.locationCode==='D01-2-03').active,false);
 assert.equal(new Set(s.locations.map(l=>l.locationCode)).size,s.locations.length);
});
