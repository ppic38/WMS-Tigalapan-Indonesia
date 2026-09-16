import {norm,newId,now} from './data.js';
import {requireMenu} from './access.js';

export const isStorageLocation=l=>Boolean(l?.allocatable&&!l.layoutRetired&&/^[A-P]\d{2}-\d-\d{2}$/.test(l.locationCode)&&l.active!==false);
export function locationDistance(a,b){
 const part=c=>[c.charCodeAt(0)-65,Number(c.slice(1,3)),Number(c.slice(6)),Number(c[4])];
 const x=part(a),y=part(b);
 return Math.abs(x[0]-y[0])*10000+Math.abs(x[1]-y[1])*100+Math.abs(x[2]-y[2])*10+Math.abs(x[3]-y[3]);
}
export function initializeLocations(s){
 for(const item of s.items){item.primaryLocation??='';item.reserveLocations??=[];item.abcClass??='';}
 s.locationAudit??=[];s.locationVersion=1;return s;
}
export function locationCapacity(s,code){
 const location=s.locations.find(l=>l.locationCode===code);
 const used=s.stock.filter(r=>r.locationCode===code).reduce((n,r)=>n+r.qty,0);
 const capacity=Number.isSafeInteger(location?.capacity)&&location.capacity>0?location.capacity:null;
 const free=capacity==null?null:Math.max(0,capacity-used);
 const blocked=location?.putawayBlocked===true,valid=isStorageLocation(location);
 return {code,location,used,capacity,free,blocked,valid,status:!valid?'Tidak aktif':blocked?'Penuh sementara':capacity==null?'Kapasitas belum diatur':free===0?'Penuh':'Tersedia'};
}
export function validateLocationMapping(s,f){
 const primaryLocation=norm(f.primaryLocation),abcClass=norm(f.abcClass);
 const reserves=Array.isArray(f.reserveLocations)?f.reserveLocations:[];
 const reserveLocations=reserves.map(norm);
 if(abcClass&&!['A','B','C'].includes(abcClass))throw Error('Klasifikasi ABC harus A, B, atau C');
 if(primaryLocation&&!isStorageLocation(s.locations.find(l=>l.locationCode===primaryLocation)))throw Error('Lokasi utama harus lokasi penyimpanan aktif zona A–P');
 if(reserveLocations.length&&!primaryLocation)throw Error('Pilih lokasi utama sebelum menambahkan reserve');
 if(reserveLocations.some(code=>!code))throw Error('Pilih setiap lokasi reserve atau hapus baris kosong');
 if(new Set(reserveLocations).size!==reserveLocations.length)throw Error('Lokasi reserve tidak boleh duplikat');
 for(const code of reserveLocations){
  if(code===primaryLocation)throw Error('Lokasi utama tidak boleh menjadi reserve SKU yang sama');
  if(!isStorageLocation(s.locations.find(l=>l.locationCode===code)))throw Error(`Reserve ${code} harus lokasi penyimpanan aktif zona A–P`);
 }
 return {primaryLocation,reserveLocations,abcClass};
}
export const mappingValue=i=>({primaryLocation:i?.primaryLocation||'',reserveLocations:[...(i?.reserveLocations||[])],abcClass:i?.abcClass||''});
function record(s,action,reference,before,after,actor){
 s.locationAudit??=[];
 s.locationAudit.push({id:newId(),at:now(),action,reference,before,after,actor:s.appUsers?.find(u=>u.id===actor)?.name||actor||'User uji'});
}
export function saveLocationMapping(s,f,actor,menu='location-control'){
 if(!['location-control','master'].includes(menu))throw Error('Menu pemetaan tidak valid');
 requireMenu(s,actor,menu);
 const item=s.items.find(i=>i.sku===norm(f.sku));if(!item)throw Error('SKU tidak ditemukan');
 if(menu==='location-control'&&f.abcClass!==undefined&&norm(f.abcClass)!==(item.abcClass||''))throw Error('Klasifikasi ABC hanya dapat diubah di Master SKU');
 if(menu==='location-control')f={...f,abcClass:item.abcClass||''};
 const next=validateLocationMapping(s,f),before=mappingValue(item);
 if(f.expected&&JSON.stringify(before)!==JSON.stringify(f.expected))throw Error('Mapping berubah sejak formulir dibuka. Tutup dan buka kembali formulir.');
 Object.assign(item,next);record(s,'Mapping SKU',item.sku,before,next,actor);
}
export function saveLocationCapacity(s,f,actor){
 requireMenu(s,actor,'location-control');
 const l=s.locations.find(l=>l.locationCode===norm(f.locationCode));if(!isStorageLocation(l))throw Error('Pilih lokasi penyimpanan aktif');
 const before={capacity:l.capacity??null,putawayBlocked:l.putawayBlocked===true};
 if(f.expected&&JSON.stringify(before)!==JSON.stringify(f.expected))throw Error('Pengaturan lokasi berubah. Buka kembali formulir.');
 const capacity=Number(f.capacity);
 if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('Kapasitas harus bilangan bulat minimal 1 pcs');
 if(capacity<locationCapacity(s,l.locationCode).used)throw Error('Kapasitas tidak boleh lebih kecil dari isi lokasi saat ini');
 const after={capacity,putawayBlocked:f.putawayBlocked===true};Object.assign(l,after);
 record(s,'Kapasitas lokasi',l.locationCode,before,after,actor);
}
export function putawayGuidance(s,sku,amount){
 const item=s.items.find(i=>i.sku===norm(sku)),primary=item?.primaryLocation?locationCapacity(s,item.primaryLocation):null;
 const reserves=(item?.reserveLocations||[]).map(code=>({...locationCapacity(s,code),distance:primary?locationDistance(primary.code,code):0})).sort((a,b)=>a.distance-b.distance||a.code.localeCompare(b.code));
 const result={primary,reserves,plan:[],recommended:null,remainingQty:0,status:'UNMAPPED',message:'Lokasi utama belum dipetakan. Hubungi tim kontrol gudang.'};
 if(!primary)return result;
 const requested=Number(amount);
 if(!Number.isSafeInteger(requested)||requested<1)return {...result,status:'INVALID_QTY',message:'Isi qty putaway minimal 1 pcs.'};
 const candidates=[{...primary,kind:'Utama'},...reserves.map(r=>({...r,kind:'Reserve'}))].filter(l=>l.valid&&!l.blocked&&l.free>0);
 const fit=candidates.find(l=>l.free>=requested);
 if(fit){const recommended={...fit,qty:requested};return {...result,recommended,plan:[recommended],status:fit.kind==='Utama'?'PRIMARY':'RESERVE',message:fit.kind==='Utama'?'Simpan ke lokasi utama.':`Lokasi utama ${primary.blocked?'ditandai penuh':primary.free==null?'belum memiliki kapasitas':primary.free===0?'penuh':'tidak cukup untuk qty ini'}. Gunakan reserve terdekat yang menampung seluruh qty.`};}
 let remaining=requested;const plan=[];
 for(const loc of candidates){if(!remaining)break;const qty=Math.min(remaining,loc.free);plan.push({...loc,qty});remaining-=qty;}
 if(plan.length)return {...result,status:'SPLIT',plan,recommended:plan[0],remainingQty:remaining,message:remaining?`Kapasitas gabungan hanya cukup untuk ${requested-remaining} pcs. Sisa ${remaining} pcs tetap di kereta sampai lokasi tersedia.`:'Qty perlu dibagi ke beberapa lokasi. Simpan per lokasi dengan qty sesuai panduan.'};
 return {...result,status:'NO_CAPACITY',remainingQty:requested,message:'Belum ada lokasi terpetakan dengan kapasitas tersedia. Tim kontrol perlu mengatur kapasitas, membuka lokasi penuh, atau menambah reserve.'};
}
export function activePutawayLocation(s,sku){
 const item=s.items.find(i=>i.sku===norm(sku));
 if(!item?.primaryLocation)return null;
 const primary={...locationCapacity(s,item.primaryLocation),kind:'Utama'};
 if(primary.valid&&!primary.blocked&&(primary.free==null||primary.free>0))return primary;
 return (item.reserveLocations||[]).map(code=>({...locationCapacity(s,code),kind:'Reserve',distance:locationDistance(primary.code,code)})).filter(l=>l.valid&&!l.blocked&&(l.free==null||l.free>0)).sort((a,b)=>a.distance-b.distance||a.code.localeCompare(b.code))[0]||null;
}
export function validatePutawayLocation(s,sku,code,amount){
 const loc=locationCapacity(s,code),item=s.items.find(i=>i.sku===sku);
 if(!loc.valid)throw Error('Tujuan putaway harus lokasi penyimpanan aktif zona A–P');
 const registered=[item?.primaryLocation,...(item?.reserveLocations||[])].filter(Boolean);
 if(!registered.length)throw Error('SKU belum memiliki lokasi utama atau reserve terdaftar. Hubungi tim kontrol untuk melengkapi master sebelum Putaway.');
 if(!registered.includes(code))throw Error('Tujuan belum dipetakan untuk SKU ini. Pilih lokasi utama atau reserve yang terdaftar.');
 const active=activePutawayLocation(s,sku);
 if(!active)throw Error('Lokasi utama dan reserve tidak memiliki kapasitas tersedia. Hubungi tim kontrol gudang.');
 if(code!==active.code)throw Error(`Lokasi tidak sesuai panduan. Scan lokasi ${active.code}.`);
 if(loc.blocked)throw Error('Lokasi ditandai penuh sementara. Pilih reserve atau hubungi tim kontrol gudang.');
 if(loc.free!=null&&amount>loc.free)throw Error(`Kapasitas lokasi tidak mencukupi; sisa ${loc.free} pcs. Ubah qty atau gunakan reserve.`);
}
export function locationAssignments(s,code){
 return s.items.flatMap(i=>[...(i.primaryLocation===code?[{item:i,kind:'Utama'}]:[]),...((i.reserveLocations||[]).includes(code)?[{item:i,kind:'Reserve'}]:[])]);
}
