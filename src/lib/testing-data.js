// Authorized reset for location mapping + Receiving testing on 2026-09-09.
// Keep the ID stable across future builds: completed test work must never reset on refresh.
export const TEST_DATASET_ID='full-cycle-test-20260909-01';
export const emptyTestingCollections=['stock','receipts','kolis','packingLists','allocations','picks','pickBatches','orders','approvals','returns','counts','movements','queue','uploads','workSessions','workEvents','cartRuns','checkingCarts','settingsAudit','locationAudit','pickingCartRuns','packingKolis','receiptItemCosts'];
export function createTestingState(base,at=new Date().toISOString()){
 const s=structuredClone(base);
 for(const key of emptyTestingCollections)s[key]=[];
 s.sequences={};s.revision=0;s.lastSaved=at;s.demo=true;
 s.codeMaster.color['085']='BT';
 // ABC test placement: A, B, C zones with a main slot and two reserve levels per SKU.
 s.locations=s.locations.filter(l=>!l.allocatable);
 s.integration={};delete s.warehouseLayout;
 s.cartMasters=[...Array.from({length:5},(_,i)=>({cartNo:`KRT-UJI-${String(i+1).padStart(3,'0')}`,capacity:280})),{cartNo:'KRT-OUT-001',capacity:60},{cartNo:'KRT-OUT-002',capacity:120}];
 const planned=s.items.map((item,i)=>{
  const abcClass=['A','B','C'][i%3],n=Math.floor(i/3),rack=String(Math.floor(n/4)+1).padStart(2,'0'),bin=String(n%4+1).padStart(2,'0');
  const locationCode=`${abcClass}${rack}-1-${bin}`,reserveLocations=[`${abcClass}${rack}-2-${bin}`,`${abcClass}${rack}-3-${bin}`];
  Object.assign(item,{primaryLocation:locationCode,reserveLocations,abcClass});
  for(const [j,code] of [locationCode,...reserveLocations].entries())s.locations.push({locationCode:code,zone:abcClass,rack,level:code[4],bin,allocatable:true,active:true,putawayBlocked:false,capacity:j===0?(i<4?[40,60,80,100][i]:500):j===1?100:400});
  return {sku:item.sku,cartNo:`KRT-UJI-${String(Math.floor(i/4)+1).padStart(3,'0')}`,locationCode,reserveLocations,abcClass};
 });
 s.demand={};s.classification={};s.oh={};s.od={};
 for(const [i,item] of s.items.entries())for(const [j,store] of s.stores.entries()){
  const key=`${store.storeId}_${item.sku}`;s.demand[key]={dad:2+(i+j)%5,updatedAt:at};s.classification[key]={class:['A','B','C'][i%3],updatedAt:at};s.oh[key]=0;s.od[key]=0;
 }
 s.teams=[{id:'INBOUND',name:'Tim Inbound'},{id:'OUTBOUND',name:'Tim Outbound'},{id:'CONTROL',name:'Kontrol Gudang'},{id:'MANAGEMENT',name:'Manajemen'}];
 s.workers=[['OP-ADMIN','Administrator Uji','MANAGEMENT'],['OP-IN-01','Operator Inbound 01','INBOUND'],['OP-IN-02','Operator Inbound 02','INBOUND'],['OP-OUT-01','Operator Outbound 01','OUTBOUND'],['OP-OUT-02','Operator Outbound 02','OUTBOUND'],['OP-SPV-01','Supervisor Uji','CONTROL'],['OP-MGR-01','Manager Uji','MANAGEMENT'],['OP-PPIC-01','PPIC Uji','CONTROL']].map(([id,name,teamId])=>({id,name,teamId,active:true}));
 s.roles=s.roles.filter(r=>r.id!=='PPIC');s.roles.push({id:'PPIC',name:'PPIC',active:true,menus:['dashboard','inventory','allocation','reports','master','location-control'],approvalRole:'PPIC'});
 s.appUsers=s.workers.map(w=>({id:w.id==='OP-ADMIN'?'USER-ADMIN':`USER-${w.id}`,name:w.name,username:w.id==='OP-ADMIN'?'admin':w.id.replace('OP-','').toLowerCase(),email:'',workerId:w.id,roleId:w.id==='OP-ADMIN'?'ADMIN':w.id.includes('-SPV-')?'SPV':w.id.includes('-MGR-')?'MANAGER':w.id.includes('-PPIC-')?'PPIC':w.teamId==='INBOUND'?'INBOUND':'OUTBOUND',active:true,menuOverrides:{}}));
 s.systemSettings={companyName:'Tigalapan Indonesia',warehouseName:'Gudang Tigalapan · Uji Receiving',landingPage:'receiving',tablePageSize:25};
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 const rows=s.items.map((item,i)=>({vendorName:'Vendor Uji Tigalapan',shippingDate:date,externalResiNo:'RESI-UJI-AWAL-001',expedition:'Ekspedisi Uji Nusantara',totalKoli:5,vendorKoliNo:`KOLI-UJI-${String(Math.floor(i/4)+1).padStart(3,'0')}`,poNumber:`PO-UJI-${String(Math.floor(i/4)+1).padStart(3,'0')}`,sku:item.sku,qty:[40,60,80,100][i%4]}));
 const reserveRows=rows.slice(0,4).map((r,i)=>({...r,externalResiNo:'RESI-UJI-RESERVE-002',totalKoli:1,vendorKoliNo:'KOLI-RESERVE-001',poNumber:'PO-UJI-RESERVE-001',qty:[20,40,160,600][i]}));
 s.testing={downloadSequence:0,resiDownloads:[],id:TEST_DATASET_ID,preparedAt:at,packingRows:rows,reserveRows,planned,filename:'resi-vendor-uji-20-line.csv',reserveFilename:'resi-uji-reserve-4-line.csv'};
 return s;
}
export function prepareTestingState(stored,baseFactory){
 if(stored?.testing?.id===TEST_DATASET_ID)return stored;
 const s=createTestingState(baseFactory());s.revision=(stored?.revision||0)+1;return s;
}
export function prepareTestingPreferences(storage){
 if(storage.getItem('wms38-test-dataset')===TEST_DATASET_ID)return false;
 storage.setItem('wms38-account','USER-ADMIN');storage.setItem('wms38-test-dataset',TEST_DATASET_ID);return true;
}

export function generateTestingResi(s,scenario='cycle',at=new Date().toISOString(),token=crypto.randomUUID()){
 if(!s.testing||!['cycle','mixed','reserve'].includes(scenario))throw Error('Pilih skenario resi uji yang tersedia.');
 const items=s.items.filter(i=>i.active&&i.primaryLocation&&i.reserveLocations?.length);
 if(items.length<20)throw Error('Lengkapi minimal 20 SKU aktif beserta lokasi utama dan reserve sebelum membuat resi uji.');
 const sequence=(s.testing.downloadSequence||0)+1,stamp=at.replace(/[^0-9]/g,'').slice(0,17),key=`${stamp}-${sequence}-${token.replaceAll('-','').slice(0,12).toUpperCase()}`;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
 const count=scenario==='reserve'?4:20,totalKoli=scenario==='reserve'?1:scenario==='mixed'?5:[5,4,10][(sequence-1)%3],perKoli=count/totalKoli;
 const rows=Array.from({length:count},(_,i)=>{
  const index=scenario==='reserve'?i:scenario==='mixed'?(i+(sequence-1))%10:(i+sequence-1)%20,item=items[index];
  const qty=scenario==='reserve'?[20,40,160,600][i]+5*((sequence-1)%5):Math.max(5,[40,60,80,100][index%4]-5*((sequence-1)%5));
  return {vendorName:['Vendor Uji Tigalapan','Vendor Uji Makassar','Vendor Uji Nusantara'][(sequence-1)%3],shippingDate:date,externalResiNo:`RESI-UJI-${key}`,expedition:'Ekspedisi Uji Nusantara',totalKoli,vendorKoliNo:`KOLI-${key}-${String(Math.floor(i/perKoli)+1).padStart(2,'0')}`,poNumber:`PO-${key}-${String(1+i%3).padStart(2,'0')}`,sku:item.sku,qty:scenario==='mixed'?Math.max(5,Math.floor(qty/2)):qty,'hpp/item':28000+index*125+sequence*10};
 });
 const pack={id:key,sequence,scenario,createdAt:at,rows,filename:`resi-uji-${scenario}-${key}.csv`};
 s.testing.downloadSequence=sequence;s.testing.resiDownloads??=[];s.testing.resiDownloads.push(pack);return pack;
}
