import React from 'react';import {renderToString} from 'react-dom/server';import assert from 'node:assert/strict';
import Receiving from '../src/modules/Receiving.jsx';import Putaway from '../src/modules/Putaway.jsx';import {Picking,Packing,Shipping} from '../src/modules/Fulfillment.jsx';import Productivity from '../src/modules/Productivity.jsx';import Workforce from '../src/modules/Workforce.jsx';
import {seed} from '../src/lib/data.js';import {importPackingList,createPickBatch,pickBatchItem} from '../src/lib/phase1.js';import {saveAllocation} from '../src/lib/actions.js';import {startWork} from '../src/lib/productivity.js';import {calculateSOQ} from '../web/js/lib/allocation.js';
const s=seed(),user='OP-OUT-01',props={s,user,act:()=>{},notify:()=>{},navigate:()=>{}};
assert(renderToString(<Receiving {...props}/>).includes('Unggah daftar isi resi vendor'));
importPackingList(s,[{packingListNo:'QA',vendorName:'Vendor',shippingDate:'',externalResiNo:'RESI',expedition:'EXP',totalKoli:1,vendorKoliNo:'V1',sku:s.items[0].sku,qty:2}], 'qa.csv',user);
let html=renderToString(<Receiving {...props}/>);assert(html.includes('Konfirmasi penerimaan koli'));assert(html.includes('Mulai kerja'));
for(const C of [Putaway,Shipping]){html=renderToString(<C {...props}/>);assert(html.includes('Mulai kerja'),C.name+' exposes the timer required by its transaction')}
const item=s.items[0],key=`ST01_${item.sku}`,st=s.stores[0],c=s.classification[key].class,ss=s.safety[`ST01_${c}`];const line={...calculateSOQ({sku:item.sku,storeId:'ST01',dad:s.demand[key].dad,oc:st.orderCycleDays,lt:st.leadTimeDays,ssd:ss.ssDemandDays,sslt:ss.ssLeadTimeDays,oh:s.oh[key],od:s.od[key],itemClass:c}),allocatedQty:2,isManualOverride:false,overrideReason:''};saveAllocation(s,[{sku:item.sku,available:100,lines:[line]}],'FAIR_SHARE_COVERAGE',true,user,'2026-09-06');const id=createPickBatch(s,{pickIds:s.picks.map(p=>p.id),assigneeId:user,startLocation:'A01-1-01'},user);
html=renderToString(<Picking {...props}/>);assert(html.includes('Mulai kerja'));assert(html.includes('Filter Store tujuan'));assert(html.includes('Filter Lokasi'));
startWork(s,'PICKING',id,user);html=renderToString(<Picking {...props}/>);assert(html.includes('SKU batch picking'));const t=s.pickBatches[0].tasks[0];pickBatchItem(s,id,t.id,{sku:t.sku,location:t.location,qty:t.qty},user);
html=renderToString(<Packing {...props}/>);assert(html.includes('Picking finish'));assert(html.includes('Mulai kerja'));assert(html.includes('Seal &amp; buat surat jalan'));
startWork(s,'PACKING',s.picks[0].id,user);html=renderToString(<Packing {...props}/>);assert(html.includes('SKU packing'));
html=renderToString(<Productivity s={s} cutoff={0}/>);assert(html.includes('Filter Qty / jam'));assert(html.includes('Operator Outbound 01'));
html=renderToString(<Workforce {...props}/>);assert(html.includes('Operator Outbound 01'));assert(html.includes('Tim Inbound'));
console.log('Phase 1 populated render: upload, intake gate, required timers, batch tasks, packing scan, productivity and workforce OK');
