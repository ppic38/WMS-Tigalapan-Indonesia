import React from 'react';
import assert from 'node:assert/strict';
import {renderToStaticMarkup as renderToString} from 'react-dom/server';
import {seed} from '../src/lib/data.js';
import {createTestingState} from '../src/lib/testing-data.js';
import {activePutawayLocation} from '../src/lib/locations.js';
import LocationControl,{LocationMap} from '../src/modules/LocationControl.jsx';
import Master from '../src/modules/Master.jsx';
import {LocationMappingEditor} from '../src/modules/LocationMapping.jsx';
import {PutawayDestination} from '../src/modules/Putaway.jsx';
import TestingPack from '../src/modules/TestingPack.jsx';
const s=createTestingState(seed()),props={s,act:()=>{},accountId:'USER-ADMIN',notify:()=>{},navigate:()=>{}};
for(const [tab,columns] of [['mapping',['ABC gudang','Lokasi utama','Lokasi reserve','Status mapping','Aksi']],['capacity',['Lokasi','Sisa (pcs)','Kapasitas (pcs)','Status','Aksi']]]){
 const html=renderToString(<LocationControl {...props} initial={tab}/>);
 assert(html.includes('Location control'));for(const c of columns)assert(html.includes(`aria-label="Filter ${c}"`),c);
}
const mapping=renderToString(<LocationControl {...props} initial="map"/>);assert(mapping.includes('Peta ABC'));assert(mapping.includes('Rak A01'));assert(mapping.includes('Lokasi A01-1-01'));assert(mapping.includes('abc-A'));assert(mapping.includes('abc-B'));assert(mapping.includes('abc-C'));
const main=renderToString(<Master {...props}/>);assert(main.includes('Filter Lokasi utama'));assert(main.includes('Filter ABC gudang'));assert(main.includes(s.items[0].primaryLocation));
const reserve=renderToString(<Master {...props} initial="reserve"/>);assert(reserve.includes('Filter Lokasi reserve'));assert(reserve.includes(s.items[0].reserveLocations[0]));
const editor=renderToString(<LocationMappingEditor {...props} item={s.items[0]} onClose={()=>{}}/>);assert(editor.includes('Reserve 1'));assert(editor.includes('Reserve 2'));assert(editor.includes('Tambah reserve'));
const filtered=renderToString(<LocationMap s={s} abc="B"/>);assert(!filtered.includes('Lokasi A01-1-01'));assert(filtered.includes('Lokasi B01-1-01'));
s.stock.push({sku:s.items[0].sku,locationCode:s.items[0].primaryLocation,qty:40});
const destination=activePutawayLocation(s,s.items[0].sku);const guide=renderToString(<PutawayDestination destination={destination}/>);assert(guide.includes(destination.kind));assert(guide.includes(destination.code));assert(guide.includes(`>${destination.free}<`));assert(!guide.includes('Scan lokasi tujuan'));assert(!guide.includes('sisa kapasitas'));assert(!guide.includes('Masukkan qty'));
const stockMap=renderToString(<LocationMap s={s} mode="stock" query={s.items[0].sku}/>);assert(stockMap.includes('40 / 40 pcs'));assert(!stockMap.includes('Lokasi B01-1-01'));
const pack=renderToString(<TestingPack s={s}/>);assert(pack.includes('Unduh resi uji reserve'));assert(pack.includes('Location control'));
console.log('Location UI render OK: Master/reserve filters, mapping/ABC/capacity views, editor, physical stock map, Putaway split guide, testing downloads.');
