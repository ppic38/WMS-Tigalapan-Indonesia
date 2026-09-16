export function calculateSOQ(p){
 const {dad,oc,lt,ssd,sslt,oh,od,itemClass}=p;
 const missing=dad==null||dad===0||!itemClass||[oc,lt,ssd,sslt,oh,od].some(v=>v==null);
 if([dad,oc,lt,ssd,sslt,oh,od].some(v=>v!=null&&(!Number.isFinite(v)||v<0)))throw Error('Parameter tidak valid');
 if(missing)return {...p,mip:null,soq:0,overstockQty:0,needsManualReview:true};
 const mip=dad*(oc+lt+ssd+sslt),raw=mip-(oh+od);
 return {...p,mip,soq:Math.max(0,Math.floor(raw)),overstockQty:Math.min(0,raw),needsManualReview:false};
}
export function distribute(stores,available,method='FAIR_SHARE_COVERAGE'){
 if(!Number.isSafeInteger(available)||available<0)throw Error('Stok tersedia harus bilangan bulat nonnegatif');
 const alloc=Object.fromEntries(stores.map(s=>[s.storeId,0]));let remaining=available;
 const eligible=stores.filter(s=>s.dad>0&&!s.needsManualReview);
 const coverage=s=>(s.oh+s.od+alloc[s.storeId])/s.dad;
 if(method==='STORE_PRIORITY'){for(const s of eligible){const n=Math.min(s.soq,remaining);alloc[s.storeId]=n;remaining-=n}return {alloc,remaining}}
 if(method==='PRO_RATA'){const total=eligible.reduce((a,s)=>a+s.soq,0);for(const s of eligible){const n=total?Math.min(s.soq,Math.floor(s.soq/total*available)):0;alloc[s.storeId]=n;remaining-=n}}
 while(remaining>0){let target=null;for(const s of eligible){if(alloc[s.storeId]>=s.soq)continue;if(!target||coverage(s)<coverage(target))target=s}if(!target)break;alloc[target.storeId]++;remaining--}
 return {alloc,remaining};
}
export function validateAllocation(lines,available){const sums={},seen=new Set();for(const l of lines){const key=JSON.stringify([l.sku,l.storeId]);if(seen.has(key))throw Error(`${l.sku} / ${l.storeId}: baris alokasi duplikat`);seen.add(key);if(l.needsManualReview&&l.allocatedQty>0)throw Error('Baris yang perlu ditinjau tidak dapat dialokasikan');if(!Number.isSafeInteger(l.allocatedQty)||l.allocatedQty<0||l.allocatedQty>l.soq)throw Error(`${l.sku} / ${l.storeId}: alokasi harus 0–${l.soq} pcs`);if(l.isManualOverride&&!l.overrideReason?.trim())throw Error('Alasan override wajib diisi');sums[l.sku]=(sums[l.sku]||0)+l.allocatedQty}for(const [sku,qty] of Object.entries(sums))if(qty>(available[sku]||0))throw Error(`${sku}: alokasi ${qty} melebihi stok tersedia ${available[sku]||0}`);return true}
export function simulate(data,onProgress=()=>{}){const rows=[];for(let i=0;i<data.items.length;i++){const item=data.items[i];const details=data.stores.map(s=>calculateSOQ({...data.params[`${s.storeId}_${item.sku}`],sku:item.sku,storeId:s.storeId}));const available=data.available[item.sku]||0;const {alloc}=distribute(details,available,data.method);rows.push({sku:item.sku,itemName:item.itemName,available,totalSOQ:details.reduce((a,d)=>a+d.soq,0),lines:details.map(d=>({...d,allocatedQty:alloc[d.storeId],isManualOverride:false,overrideReason:''}))});if(i%20===0)onProgress(Math.round((i+1)/data.items.length*100))}return rows}
