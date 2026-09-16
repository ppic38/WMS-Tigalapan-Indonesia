import {newId,now,norm} from './data.js';
import {requireMenu} from './access.js';
import {isStorageLocation,locationCapacity} from './locations.js';

const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const number=(v,min=0)=>v!==''&&v!=null&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=10000;
export function addLayoutLocations(s,input,actor){
 requireMenu(s,actor,'location-control');
 const rack=norm(input.rack),firstLevel=Number(input.firstLevel),lastLevel=Number(input.lastLevel),firstBin=Number(input.firstBin),lastBin=Number(input.lastBin),capacity=Number(input.capacity);
 if(!/^[A-P]\d{2}$/.test(rack))throw Error('Nomor rak harus zona A–P dan dua angka, misalnya A03');
 if(![firstLevel,lastLevel].every(n=>Number.isInteger(n)&&n>=1&&n<=9)||firstLevel>lastLevel)throw Error('Rentang level harus 1–9 dengan urutan yang benar');
 if(![firstBin,lastBin].every(n=>Number.isInteger(n)&&n>=1&&n<=99)||firstBin>lastBin)throw Error('Rentang bin harus 1–99 dengan urutan yang benar');
 if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('Kapasitas setiap lokasi minimal 1 pcs');
 const codes=[];for(let level=firstLevel;level<=lastLevel;level++)for(let bin=firstBin;bin<=lastBin;bin++)codes.push(`${rack}-${level}-${String(bin).padStart(2,'0')}`);
 const existing=codes.find(code=>s.locations.some(l=>l.locationCode===code));if(existing)throw Error(`Lokasi ${existing} sudah terdaftar. Ubah rentang agar tidak duplikat.`);
 const added=codes.map(locationCode=>({locationCode,zone:rack[0],rack:rack.slice(1),level:locationCode[4],bin:locationCode.slice(6),allocatable:true,active:true,capacity,putawayBlocked:false}));
 s.locations.push(...added);s.locationAudit??=[];s.locationAudit.push({id:newId(),at:now(),action:'Tambah lokasi',reference:rack,before:[],after:structuredClone(added),actor:s.appUsers.find(u=>u.id===actor)?.name||actor});
 return codes;
}
export function storageRacks(s){
 const byId=new Map();
 for(const l of s.locations.filter(l=>l.allocatable&&!l.layoutRetired&&/^[A-P]\d{2}-\d-\d{2}$/.test(l.locationCode))){
  const id=l.locationCode.slice(0,3);
  if(!byId.has(id))byId.set(id,{id,cells:[]});
  byId.get(id).cells.push(l);
 }
 return [...byId.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({...r,
  bins:[...new Set(r.cells.map(l=>l.locationCode.slice(-2)))].sort(),
  levels:[...new Set(r.cells.map(l=>l.locationCode[4]))].sort()
 }));
}
export function rackStructureVersion(s,id){
 return JSON.stringify(s.locations.filter(l=>l.locationCode.startsWith(`${id}-`)).map(l=>[l.locationCode,l.active!==false,!!l.layoutRetired,l.capacity??null,!!l.putawayBlocked]).sort((a,b)=>a[0].localeCompare(b[0])));
}
function containsLocation(value,code){
 if(typeof value==='string')return value===code;
 if(Array.isArray(value))return value.some(v=>containsLocation(v,code));
 return !!value&&typeof value==='object'&&Object.values(value).some(v=>containsLocation(v,code));
}
export function planRackStructure(s,input){
 const rack=norm(input.rack),levels=Number(input.levels),bins=Number(input.bins),catalog=storageRacks(s).find(r=>r.id===rack);
 if(!catalog)throw Error('Pilih rak yang sudah terdaftar.');
 if(!Number.isInteger(levels)||levels<1||levels>9||!Number.isInteger(bins)||bins<1||bins>99)throw Error('Jumlah level harus 1–9 dan bin per level 1–99.');
 const desired=[];for(let level=1;level<=levels;level++)for(let bin=1;bin<=bins;bin++)desired.push(`${rack}-${level}-${String(bin).padStart(2,'0')}`);
 const codes=new Set(desired),known=new Map(s.locations.map(l=>[l.locationCode,l]));
 const added=desired.filter(code=>!known.has(code)),restored=desired.filter(code=>known.get(code)?.layoutRetired),retired=catalog.cells.filter(l=>!codes.has(l.locationCode)).map(l=>l.locationCode),blocked=[];
 const terminal=new Set(['APPROVED','REJECTED','CANCELLED','CANCELED','COMPLETED','DONE','SHIPPED','FINISHED','MATCHED']);
 const isOpen=(key,doc)=>{
  if(terminal.has(doc.status)||key==='returns'&&doc.status==='SELLABLE')return false;
  if(key==='counts'||key==='returns'){
   const type=key==='counts'?'OPNAME':'RETURN',decision=(s.approvals||[]).filter(a=>a.type===type&&a.refDoc===doc.id).at(-1);
   if(decision&&terminal.has(decision.status))return false;
  }
  return true;
 };
 for(const code of retired){
  const reasons=[];
  if(s.stock.some(r=>r.locationCode===code&&Number(r.qty)!==0))reasons.push('masih berisi stok');
  if(s.items.some(i=>i.primaryLocation===code||(i.reserveLocations||[]).includes(code)))reasons.push('masih dipetakan sebagai lokasi utama/reserve SKU');
  for(const [key,label] of [['pickBatches','batch picking'],['picks','picking'],['orders','packing/shipping'],['counts','stock opname'],['approvals','persetujuan'],['returns','retur']]){
   if((s[key]||[]).some(doc=>isOpen(key,doc)&&containsLocation(doc,code)))reasons.push(`masih dipakai ${label}`);
  }
  if(reasons.length)blocked.push({code,reasons});
 }
 return {rack,levels,bins,total:desired.length,added,restored,retired,blocked};
}
export function resizeRackStructure(s,input,actor){
 requireMenu(s,actor,'location-control');
 const rack=norm(input.rack);
 if(input.expected!==rackStructureVersion(s,rack))throw Error('Struktur atau kapasitas rak berubah. Tutup lalu buka kembali pengaturan bin dan level.');
 const plan=planRackStructure(s,input);
 if(plan.blocked.length)throw Error(`Lokasi ${plan.blocked[0].code} ${plan.blocked[0].reasons.join(', ')}. Selesaikan pemakaian atau pindahkan mapping terlebih dahulu.`);
 const capacity=Number(input.capacity);
 if(plan.added.length&&(!Number.isSafeInteger(capacity)||capacity<1))throw Error('Isi kapasitas lokasi baru dengan bilangan bulat minimal 1 pcs.');
 if(!plan.added.length&&!plan.retired.length&&!plan.restored.length)return plan;
 const affected=new Set([...plan.added,...plan.retired,...plan.restored]),before=s.locations.filter(l=>affected.has(l.locationCode)).map(l=>structuredClone(l)),at=now();
 for(const code of plan.retired){const l=s.locations.find(l=>l.locationCode===code);l.layoutPreviousActive=l.active!==false;l.layoutRetired=true;l.layoutRetiredAt=at;l.active=false;}
 for(const code of plan.restored){const l=s.locations.find(l=>l.locationCode===code);l.active=l.layoutPreviousActive!==false;delete l.layoutPreviousActive;delete l.layoutRetired;delete l.layoutRetiredAt;}
 for(const locationCode of plan.added)s.locations.push({locationCode,zone:rack[0],rack:rack.slice(1),level:locationCode[4],bin:locationCode.slice(6),allocatable:true,active:true,capacity,putawayBlocked:false});
 s.locationAudit??=[];s.locationAudit.push({id:newId(),at,action:'Struktur rak',reference:rack,before,after:s.locations.filter(l=>affected.has(l.locationCode)).map(l=>structuredClone(l)),levels:plan.levels,bins:plan.bins,actor:s.appUsers.find(u=>u.id===actor)?.name||actor});
 return plan;
}
export function defaultWarehouseLayout(s){
 const catalog=storageRacks(s),columns=Math.min(3,Math.max(1,catalog.length));
 const pitch=Math.max(2,...catalog.map(r=>r.bins.length*1.1))+2;
 return {revision:0,warehouse:{width:round(columns*pitch+2),depth:Math.max(6,Math.ceil(catalog.length/columns)*4.2+2)},racks:catalog.map((r,i)=>({id:r.id,x:round(1+i%columns*pitch),y:round(1+Math.floor(i/columns)*4.2),width:round(Math.max(1.2,r.bins.length*1.1)),depth:1.2,height:round(Math.max(2.2,r.levels.length*0.8)),rotation:0}))};
}
export function currentWarehouseLayout(s){
 const fallback=defaultWarehouseLayout(s),saved=s.warehouseLayout;
 if(!saved)return {...fallback,configured:false,unplaced:fallback.racks.map(r=>r.id)};
 const actual=new Map((saved.racks||[]).map(r=>[r.id,r]));
 return {revision:saved.revision||0,warehouse:{...saved.warehouse},racks:fallback.racks.map(r=>({...actual.get(r.id)||{...r,x:0,y:0}})),configured:true,unplaced:fallback.racks.filter(r=>!actual.has(r.id)).map(r=>r.id),updatedAt:saved.updatedAt};
}
export function rackFootprint(r){return {x:Number(r.x),y:Number(r.y),width:Number(r.rotation)%180?Number(r.depth):Number(r.width),depth:Number(r.rotation)%180?Number(r.width):Number(r.depth)}};
export function rackPoint(r,[x,y,z=0]){
 const turn=Number(r.rotation)||0;
 const point=turn===90?[Number(r.depth)-y,x]:turn===180?[Number(r.width)-x,Number(r.depth)-y]:turn===270?[y,Number(r.width)-x]:[x,y];
 return [Number(r.x)+point[0],Number(r.y)+point[1],z];
}
export function layoutIssues(layout,catalogIds){
 const issues=[],add=(message,racks=[])=>issues.push({message,racks});
 const floor=layout.warehouse||{},racks=layout.racks||[];
 if(!number(floor.width,0.1)||!number(floor.depth,0.1))add('Isi lebar dan panjang gudang antara 0,1–10.000 meter.');
 const ids=racks.map(r=>r.id);
 if(new Set(ids).size!==ids.length)add('Nomor rak tidak boleh duplikat.');
 if(catalogIds&&(ids.length!==catalogIds.length||ids.some(id=>!catalogIds.includes(id))))add('Daftar rak berubah. Muat layout terbaru agar seluruh rak dari Master lokasi disertakan.');
 const valid=[];
 for(const r of racks){
  if(!number(r.x)||!number(r.y)||!number(r.width,0.1)||!number(r.depth,0.1)||!number(r.height,0.1)||![0,90,180,270].includes(Number(r.rotation))){add(`Rak ${r.id}: isi posisi, ukuran positif, dan arah 0°, 90°, 180°, atau 270°.`,[r.id]);continue}
  const f=rackFootprint(r);valid.push({id:r.id,...f});
  if(f.x+f.width>Number(floor.width)+1e-7||f.y+f.depth>Number(floor.depth)+1e-7)add(`Rak ${r.id} berada di luar batas gudang.`,[r.id]);
 }
 for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++){
  const a=valid[i],b=valid[j];
  if(a.x<b.x+b.width-1e-7&&a.x+a.width>b.x+1e-7&&a.y<b.y+b.depth-1e-7&&a.y+a.depth>b.y+1e-7)add(`Rak ${a.id} bertumpuk dengan ${b.id}.`,[a.id,b.id]);
 }
 return issues;
}
export function moveRack(layout,id,x,y,step=0.1){
 const r=layout.racks.find(r=>r.id===id);if(!r)return layout;
 const f=rackFootprint(r),snap=v=>round(Math.round(v/step)*step);
 const next={...r,x:Math.max(0,Math.min(snap(x),Math.max(0,Number(layout.warehouse.width)-f.width))),y:Math.max(0,Math.min(snap(y),Math.max(0,Number(layout.warehouse.depth)-f.depth)))};
 return {...layout,racks:layout.racks.map(r=>r.id===id?next:r)};
}
export function saveWarehouseLayout(s,input,actor){
 requireMenu(s,actor,'location-control');
 if(input.expectedRevision!==(s.warehouseLayout?.revision||0))throw Error('Layout berubah sejak dibuka. Muat layout terbaru sebelum menyimpan.');
 const issues=layoutIssues(input,storageRacks(s).map(r=>r.id));if(issues.length)throw Error(issues[0].message);
 const before=s.warehouseLayout?structuredClone(s.warehouseLayout):null;
 const after={version:1,revision:(before?.revision||0)+1,warehouse:{width:round(Number(input.warehouse.width)),depth:round(Number(input.warehouse.depth))},racks:input.racks.map(r=>Object.fromEntries(['id','x','y','width','depth','height','rotation'].map(k=>[k,k==='id'?r.id:round(Number(r[k]))]))).sort((a,b)=>a.id.localeCompare(b.id)),updatedAt:now()};
 const normalizedIssues=layoutIssues(after);if(normalizedIssues.length)throw Error(normalizedIssues[0].message);
 s.warehouseLayout=after;s.locationAudit??=[];
 s.locationAudit.push({id:newId(),at:after.updatedAt,action:'Layout gudang',reference:'LAYOUT-GUDANG',before,after:structuredClone(after),actor:s.appUsers.find(u=>u.id===actor)?.name||actor});
 return after;
}
export function warehouseUtilization(s){
 const locations=s.locations.filter(isStorageLocation).map(l=>locationCapacity(s,l.locationCode));
 const known=locations.filter(l=>l.capacity!=null),capacity=known.reduce((n,l)=>n+l.capacity,0),used=known.reduce((n,l)=>n+l.used,0);
 const occupied=locations.filter(l=>l.used>0).length,layout=currentWarehouseLayout(s),issues=layoutIssues(layout,storageRacks(s).map(r=>r.id));
 const measured=layout.configured&&!layout.unplaced.length&&!issues.length;
 const floorArea=measured?Number(layout.warehouse.width)*Number(layout.warehouse.depth):null,rackArea=measured?layout.racks.reduce((n,r)=>n+r.width*r.depth,0):null;
 return {locations:locations.length,occupied,empty:locations.length-occupied,blocked:locations.filter(l=>l.blocked).length,full:locations.filter(l=>l.free===0).length,locationPercent:locations.length?occupied/locations.length*100:null,capacity,used,known:known.length,unknown:locations.length-known.length,capacityPercent:capacity?used/capacity*100:null,floorArea,rackArea,areaPercent:floorArea?rackArea/floorArea*100:null,unplaced:layout.unplaced.length,layoutConfigured:layout.configured};
}
