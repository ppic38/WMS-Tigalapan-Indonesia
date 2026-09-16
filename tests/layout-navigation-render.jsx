import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {seed,applyMutation} from '../src/lib/data.js';
import {createTestingState} from '../src/lib/testing-data.js';
import {addLayoutLocations,rackStructureVersion,resizeRackStructure} from '../src/lib/warehouse-layout.js';
import {NavigationGroups,navigation,readNavigationPreferences} from '../src/Sidebar.jsx';
import RackStructureEditor from '../src/modules/RackStructureEditor.jsx';
import Rack3D,{rackScene,rackGeometry} from '../src/modules/Rack3D.jsx';
import LocationControl from '../src/modules/LocationControl.jsx';
import {Modal} from '../src/ui.jsx';

const all=navigation.flatMap(g=>g.items.map(i=>i[0])),noop=()=>{};
let html=render(<NavigationGroups allowed={all} active="putaway" collapsed={{operasional:true,kontrol:true}} onToggle={noop} pendingReceiving={5}/>);
for(const name of ['Overview','Operasional','Kontrol gudang','Pengelolaan','Pengaturan'])assert(html.includes(name));
for(const id of ['operasional','kontrol']){assert(html.includes(`aria-expanded="false" aria-controls="navigation-${id}"`));assert(html.includes(`id="navigation-${id}" class="nav-section-items" hidden=""`))}
for(const id of ['overview','pengelolaan']){assert(html.includes(`aria-expanded="true" aria-controls="navigation-${id}"`));assert(!html.includes(`id="navigation-${id}" class="nav-section-items" hidden=""`))}
assert(html.includes('aria-current="page"'));assert(html.includes('<b>5</b>'));
html=render(<NavigationGroups allowed={['receiving','putaway']} active="receiving" onToggle={noop}/>);
assert(html.includes('Operasional'));for(const name of ['Overview','Kontrol gudang','Pengelolaan','Pengaturan','#shipping','#master','#settings-users'])assert(!html.includes(name),name);
const pref=readNavigationPreferences({getItem:()=>JSON.stringify({sidebarCollapsed:true,groups:{overview:true,operasional:false,kontrol:true,pengelolaan:true}})});
assert.equal(pref.sidebarCollapsed,true);assert.equal(pref.groups.kontrol,true);assert.equal(pref.groups.operasional,false);assert.equal(pref.groups.pengaturan,false);
assert.equal(readNavigationPreferences({getItem:()=>'{bad'}).sidebarCollapsed,false);assert.equal(readNavigationPreferences(null).sidebarCollapsed,false);

let s=createTestingState(seed());const before=structuredClone(s),props={s,act:noop,accountId:'USER-ADMIN'};
html=render(<RackStructureEditor {...props} rack="A01" onClose={noop}/>);
for(const label of ['Jumlah level','Jumlah bin per level','Simpan bin &amp; level','bin dari 01'])assert(html.includes(label),label);
assert(html.includes('disabled=""'));assert.deepEqual(s,before);
html=render(<LocationControl {...props} initial="layout"/>);assert(html.includes('Ubah bin &amp; level'));
html=render(<LocationControl {...props} initial="map"/>);assert(html.includes('Layar penuh'));
html=render(<Modal fullscreen title="Peta rak 3D" onClose={noop}><Rack3D s={s} expanded onSelect={noop}/></Modal>);
assert(html.includes('fullscreen'));assert(html.includes('rack3d-expanded'));assert(html.includes('aria-label="Tutup"'));assert(!html.includes('NaN'));assert(!html.includes('Infinity'));
assert.equal((html.match(/class="rack3d-bin" role="button" tabindex="0"/g)||[]).length,60);

addLayoutLocations(s,{rack:'D01',firstLevel:1,lastLevel:2,firstBin:1,lastBin:3,capacity:100},'USER-ADMIN');
s=applyMutation(s,d=>resizeRackStructure(d,{rack:'D01',levels:1,bins:2,expected:rackStructureVersion(d,'D01')},'USER-ADMIN'));
assert.equal(rackScene(s).length,62);assert(!rackScene(s).some(l=>l.code==='D01-2-03'));
let geometry=rackGeometry(s,rackScene(s)).find(r=>r.id==='D01');assert.equal(geometry.levels.length,1);assert.equal(geometry.bins.length,2);
s=applyMutation(s,d=>resizeRackStructure(d,{rack:'D01',levels:3,bins:4,capacity:80,expected:rackStructureVersion(d,'D01')},'USER-ADMIN'));
geometry=rackGeometry(s,rackScene(s)).find(r=>r.id==='D01');assert.equal(geometry.levels.length,3);assert.equal(geometry.bins.length,4);assert.equal(rackScene(s).length,72);
console.log('Navigation permissions, independent collapsed groups, preference restoration, structure form, full-window map and resized 3D geometry passed.');
