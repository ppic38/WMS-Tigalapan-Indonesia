import React from 'react';import assert from 'node:assert/strict';import {renderToStaticMarkup as render} from 'react-dom/server';
import {seed} from '../src/lib/data.js';import {createTestingState,generateTestingResi} from '../src/lib/testing-data.js';import {importPackingList} from '../src/lib/phase1.js';
import Receiving from '../src/modules/Receiving.jsx';import Putaway from '../src/modules/Putaway.jsx';import {Picking,Packing} from '../src/modules/CartFulfillment.jsx';import {Shipping} from '../src/modules/Fulfillment.jsx';import Reports from '../src/modules/Reports.jsx';
const s=createTestingState(seed()),pack=generateTestingResi(s);for(const r of pack.rows)r['hpp/item']=98765.43;importPackingList(s,pack.rows,pack.filename,'OP-IN-01');
const props={s,user:'OP-ADMIN',accountId:'USER-ADMIN',role:'SPV',act:()=>{},notify:()=>{},navigate:()=>{}};
for(const Component of [Receiving,Putaway,Picking,Packing,Shipping,Reports]){const html=render(<Component {...props}/>);for(const text of ['98765.43','98.765,43','hpp/item','hppPerItem'])assert(!html.includes(text),`${Component.name}: cost visible`)}
assert.equal(s.receiptItemCosts[0].hppMinor,9876543);console.log('Receipt costs persist without appearing in warehouse operational components.');
