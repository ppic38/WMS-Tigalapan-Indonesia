import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesFilter, filterRows, paginateRows, numberValue, distinctValues, validRange, isActiveFilter} from '../src/lib/table-filters.js';
const columns=[{type:'text'},{type:'text'},{type:'number'}];
const rows=Array.from({length:32},(_,i)=>({key:`SKU-${i+1}`,values:[`SKU-${i+1}`,i%2?'MAMU':'TIGA',i]}));
test('filter searches complete data before pagination and clamps a previous page',()=>{
 const filtered=filterRows(rows,{0:{query:'SKU-32'}},columns);
 const view=paginateRows(filtered,3,15);
 assert.deepEqual(view.rows.map(r=>r.key),['SKU-32']);assert.equal(view.page,1);assert.equal(view.pages,1);
});
test('column filters combine with AND; selected values combine with OR',()=>{
 const result=filterRows(rows,{1:{values:['mamu']},2:{min:'20',max:'25'}},columns);
 assert.deepEqual(result.map(r=>r.values[2]),[21,23,25]);
 assert.equal(filterRows(rows,{1:{values:['mamu','tiga']}},columns).length,32);
});
test('zero is an active exact numeric constraint, distinct from missing values',()=>{
 assert.equal(isActiveFilter({min:0,max:0}),true);
 for(const value of [0,'0','0 pcs']) assert.equal(matchesFilter(value,{min:'0',max:'0'},'number'),true);
 for(const value of [null,undefined,'','—','Tidak diatur',1]) assert.equal(matchesFilter(value,{min:'0',max:'0'},'number'),false);
 assert.equal(matchesFilter('Tidak diatur',{presence:'empty'},'number'),true);
});
test('ranges compare raw numbers, local decimals, thousands and negative variance',()=>{
 assert.equal(numberValue('1.234,5 pcs'),1234.5);assert.equal(numberValue('12.000'),12000);
 assert.equal(numberValue(1.234),1.234);assert.equal(numberValue('−5 rusak'),null);
 assert.equal(matchesFilter(-5,{min:-6,max:-1},'number'),true);
 assert.equal(matchesFilter(10,{min:2,max:9},'number'),false);
 assert.equal(matchesFilter(1.2345,{min:1.2344,max:1.2346},'number'),true);
});
test('invalid ranges cannot be applied; blank boundaries are optional',()=>{
 assert.equal(validRange({min:10,max:0}),false);assert.equal(validRange({min:'no',max:''}),false);
 assert.equal(validRange({min:'',max:0}),true);assert.equal(validRange({min:-10,max:''}),true);
});
test('filter text is case insensitive and keeps category and SKU codes as text',()=>{
 assert.equal(matchesFilter('B10-085B301 Crewneck MAMU L',{query:' crewneck mamu '}),true);
 assert.equal(matchesFilter('01',{values:['01']}),true);assert.equal(matchesFilter('1',{values:['01']}),false);
 assert.equal(matchesFilter('L–XL',{query:'xl'}),true);
});
test('all values, no selected values, and empty result have separate meanings',()=>{
 assert.equal(filterRows(rows,{1:{values:null}},columns).length,32);
 assert.equal(filterRows(rows,{1:{values:[]}},columns).length,0);
 assert.deepEqual(paginateRows([],2,15),{rows:[],page:1,pages:1});
 const options=distinctValues([{values:[0]},{values:[0]},{values:[null]}],0);
 assert.equal(options.find(o=>o.key==='0').count,2);assert.equal(options.find(o=>o.key==='').label,'(Kosong)');
});
test('filters and pagination do not mutate inventory rows or filter settings',()=>{
 const before=structuredClone(rows), filters={1:{values:['mamu']},2:{min:0,max:30}}, original=structuredClone(filters);
 paginateRows(filterRows(rows,filters,columns),2,15);
 assert.deepEqual(rows,before);assert.deepEqual(filters,original);
 // Re-evaluating updated stock uses its current value, not a cached snapshot.
 const updated=rows.map(r=>r.key==='SKU-1'?{...r,values:[...r.values.slice(0,2),100]}:r);
 assert.equal(filterRows(updated,{2:{min:100}},columns)[0].key,'SKU-1');
});
