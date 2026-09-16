import {closeCheckingCart} from '../src/lib/carts.js';
import React from 'react';
import {renderToString} from 'react-dom/server';
import assert from 'node:assert/strict';
import Receiving,{Checking} from '../src/modules/Receiving.jsx';
import Putaway from '../src/modules/Putaway.jsx';
import {seed} from '../src/lib/data.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck} from '../src/lib/phase1.js';
import {startWork} from '../src/lib/productivity.js';
const s=seed(),user='OP-IN-01',props={s,user,act:()=>{},notify:()=>{},navigate:()=>{},onIntake:()=>{}};
const ids=[];
for(const id of ['FIRST','SECOND','UNRECEIVED']){
 const receiptId=importPackingList(s,[{packingListNo:'PL-'+id,vendorName:'Vendor '+id,externalResiNo:id,expedition:'Uji',totalKoli:1,vendorKoliNo:'KOLI-'+id,sku:s.items[0].sku,qty:2}],'test.csv',user)[0];
 const k=s.kolis.find(k=>k.internalResiNo===receiptId);ids.push(k.koliNo);
 if(id!=='UNRECEIVED'){startWork(s,'RECEIVING',receiptId,user);receiveKoli(s,receiptId,k.koliNo,user);confirmKoliIntake(s,receiptId,user)}
}
let html=renderToString(<Checking {...props}/>);
assert(html.includes('KOLI-FIRST'));assert(html.includes('KOLI-SECOND'));assert(!html.includes('KOLI-UNRECEIVED'));
assert(html.includes('Pilih koli yang menunggu'));assert(!html.includes('Packing list / kiriman'));
startWork(s,'CHECKING',ids[1],user);
html=renderToString(<Receiving {...props}/>);
assert(html.includes('Nomor kereta'));assert(html.includes('Gunakan kereta'));assert(!html.includes('Packing list / kiriman'));assert(!html.includes('aria-label="SKU pengecekan koli"'));
beginKoliCart(s,ids[1],'KRT-01',user);checkKoliItem(s,ids[1],s.items[0].sku,'',2,'GOOD',user,'KRT-01');
html=renderToString(<Receiving {...props}/>);
assert(html.includes('aria-label="SKU pengecekan koli"'));assert(html.includes('Close kereta'));assert(html.includes('Hasil scan per kereta'));assert(html.includes('Filter Nomor kereta'));assert(html.includes('Filter Kereta'));
finishKoliCheck(s,ids[1],{},user);
html=renderToString(<Checking {...props}/>);assert(!html.includes('KOLI-SECOND'));assert(html.includes('KOLI-FIRST'));
closeCheckingCart(s,'KRT-01',user);html=renderToString(<Putaway {...props}/>);assert(html.includes('KRT-01'));assert(html.includes('Kereta asal'));assert(html.includes('Filter Nomor kereta'));
console.log('Cart render OK: global queue, no shipment picker, required cart before scanning, filterable cart results and Putaway');
