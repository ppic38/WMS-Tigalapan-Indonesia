import {migrateCartLifecycle} from './carts.js';
import {prepareTestingState} from './testing-data.js';
import {initializeSettings} from './access.js';
import {initializeLocations} from './locations.js';
export function newId(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export const SKU_RE=/^[A-C]\d{2}-\d{3}[A-C]\d(\d{2})?$/;
export const LOCATION_RE=/^[A-Z]\d{2}-\d-\d{2}$/;
export const norm=s=>String(s||'').trim().toUpperCase();
export const now=()=>new Date().toISOString();
export const dateKey=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Makassar'}).replaceAll('-','').slice(2);
export function docNo(s,prefix,digits=3){const key=`${prefix}-${dateKey()}`;s.sequences[key]=(s.sequences[key]||0)+1;return `${key}-${String(s.sequences[key]).padStart(digits,'0')}`}
export function seed(){
 const colors=[['106','Hitam','#272b32'],['097','Abu Sedang','#9aa0a8'],['052','Sky Blue','#8ac9e5'],['080','Merah Cabe','#c94040'],['001','Putih','#f4f4ef'],['060','Navy','#2c426a']];
 const items=colors.flatMap(([color,label,hex],i)=>['2','3','4'].map(size=>({sku:`B01-${color}A${size}`,itemName:`Kaos Polos 24S · ${label}`,brand:'B',category:'01',color,sleeve:'A',size,note:'',colorName:label,hex,active:true})));
 items.push({sku:'B10-085B301',itemName:'Crewneck MAMU · BT',brand:'B',category:'10',color:'085',sleeve:'B',size:'3',note:'01',colorName:'Contoh warna 085',hex:'#ae977a',active:true});
 items.push({sku:'B01-097A5',itemName:'Kaos Polos 24S · Abu Sedang',brand:'B',category:'01',color:'097',sleeve:'A',size:'5',note:'',colorName:'Abu Sedang',hex:'#9aa0a8',active:true});
 const names=['Makassar','Palu','Manado','Kendari','BTP','MAMU Tamalate','Samarinda','Balikpapan','Gorontalo','Parepare','Bone','Mamuju'];
 const stores=names.map((storeName,i)=>({storeId:`ST${String(i+1).padStart(2,'0')}`,storeName,active:true,isDC:false,mokaOutletId:'',orderCycleDays:7,leadTimeDays:i<4?3:2,priority:i+1}));
 const locations=['A01-1-01','A01-1-02','A01-2-01','A02-1-01','B01-1-01','B01-2-01','S01-1-01','Q01-1-01','R01-1-01','V01-1-01'].map(locationCode=>({locationCode,zone:locationCode[0],rack:locationCode.slice(1,3),level:locationCode[4],bin:locationCode.slice(6),allocatable:/^[A-P]/.test(locationCode),capacity:null}));
 const stock=items.map((v,i)=>({sku:v.sku,locationCode:locations[i%6].locationCode,qty:i===0?100:i===10?0:80+i*13}));
 stock.push({sku:items[0].sku,locationCode:'S01-1-01',qty:24},{sku:items[1].sku,locationCode:'S01-1-01',qty:36});
 const demand={},classification={},oh={},od={};
 for(let i=0;i<items.length;i++)for(let j=0;j<stores.length;j++){const k=`${stores[j].storeId}_${items[i].sku}`;demand[k]={dad:i===10?0:[8,5,6,4,3,2][j%6]+i%3,updatedAt:now()};classification[k]={class:['A','B','C'][i%3],updatedAt:now()};oh[k]=[40,5,60,2,8,14][j%6]+i*2;od[k]=j===0?12:j===2?10:0}
 const safety=Object.fromEntries(stores.flatMap(s=>['A','B','C'].map(c=>[`${s.storeId}_${c}`,{ssDemandDays:c==='A'?2:1,ssLeadTimeDays:2}])));
 const resi=`RC-${dateKey()}-001`,koli=`KL-${dateKey()}-0001`;
 return migrateState({version:1,revision:0,demo:true,items,stores,locations,stock,demand,classification,oh,od,safety,codeMaster:{brand:{A:'TIGALAPAN',B:'MAMU',C:'MYNO'},category:{'01':'24S MAMU','10':'CREWNECK MAMU'},color:Object.fromEntries(colors.map(c=>[c[0],c[1]])),sleeve:{A:'PENDEK',B:'PANJANG',C:'3/4'},size:{0:'XS',1:'S',2:'M',3:'L',4:'XL',5:'2XL',6:'3XL',7:'4XL',8:'S-M',9:'L-XL'},note:{'01':'BT','04':'ZIPPER','11':'HITAM','17':'LONG'}},receipts:[{internalResiNo:resi,externalResiNo:'EXP-TGL-0826',expedition:'Ekspedisi Nusantara',receivedAt:now(),status:'CHECKING'}],kolis:[{koliNo:koli,internalResiNo:resi,position:'1/1',status:'PENDING',expectedItems:[{sku:items[0].sku,poNumber:'PO-2609-001',qtyExpected:24},{sku:items[1].sku,poNumber:'PO-2609-002',qtyExpected:12},{sku:items[2].sku,poNumber:'PO-2609-003',qtyExpected:12}],scannedItems:[]}],allocations:[],picks:[],orders:[],approvals:[],returns:[],counts:[],movements:[],queue:[],uploads:[],sequences:{[`RC-${dateKey()}`]:1,[`KL-${dateKey()}`]:1},lastSaved:now()});
}
export function migrateState(s){
 const before=s.phase1Version||0;
 s.receiptItemCosts??=[];s.cartMasters??=[];s.pickingCartRuns??=[];s.packingKolis??=[];
 s.packingLists??=[];s.pickBatches??=[];s.workSessions??=[];s.workEvents??=[];s.cartRuns??=[];
 s.teams??=[{id:'INBOUND',name:'Tim Inbound'},{id:'OUTBOUND',name:'Tim Outbound'}];
 s.workers??=[{id:'OP-IN-01',name:'Operator Inbound 01',teamId:'INBOUND',active:true},{id:'OP-OUT-01',name:'Operator Outbound 01',teamId:'OUTBOUND',active:true}];
 for(const r of s.receipts){const ks=s.kolis.filter(k=>k.internalResiNo===r.internalResiNo);r.expectedKoli??=ks.length;r.vendorName??='Vendor sebelumnya';for(const k of ks){k.vendorKoliNo??=k.koliNo;if(before<1&&(k.scannedItems.length||['CLOSED','DISCREPANCY','CHECKING'].includes(k.status))){k.arrivedAt??=k.closedAt||r.receivedAt;k.arrivedBy??='LEGACY'}}if(before<1&&ks.length&&ks.every(k=>k.arrivedAt))r.intakeConfirmedAt??=r.receivedAt;}
 s.resiVersion=1;
 if(s.testing){s.testing.packingRows=s.testing.packingRows.map(({packingListNo,...row})=>row);s.testing.filename='resi-vendor-uji-20-line.csv'}
 s.phase1Version=1;return initializeLocations(migrateCartLifecycle(initializeSettings(s)));
}
export const findItem=(s,sku)=>s.items.find(v=>v.sku===norm(sku));
export function qty(n){const v=Number(n);if(n==null||String(n).trim()===''||!Number.isSafeInteger(v)||v<0)throw Error('Jumlah harus bilangan bulat 0 atau lebih');return v}
export function pickedAt(s,sku,location){return s.picks.filter(p=>!['SHIPPED','CANCELLED'].includes(p.status)).flatMap(p=>p.lines).filter(l=>l.sku===sku).flatMap(l=>l.sources).filter(x=>x.location===location).reduce((n,x)=>n+x.qty-(x.shippedQty||0),0)}
export function physical(s,sku){return s.stock.filter(r=>r.sku===sku&&/^[A-P]/.test(r.locationCode)).reduce((a,r)=>a+r.qty,0)}
export function reserved(s,sku){return s.allocations.filter(a=>['CONFIRMED','PENDING_SPV','PENDING_MANAGER'].includes(a.status)).reduce((n,a)=>n+a.lines.filter(l=>l.sku===sku).reduce((t,l)=>t+l.allocatedQty-(l.shippedQty||0),0),0)}
export function available(s,sku){return Math.max(0,physical(s,sku)-reserved(s,sku))}
export function move(s,sku,amount,from,to,type,refDoc,userId){qty(amount);if(!amount)return;if(from){const r=s.stock.find(x=>x.sku===sku&&x.locationCode===from);if(!r||r.qty<amount)throw Error(`${sku}: stok di ${from} tidak cukup`);r.qty-=amount}if(to){let r=s.stock.find(x=>x.sku===sku&&x.locationCode===to);if(!r){r={sku,locationCode:to,qty:0};s.stock.push(r)}r.qty=qty(r.qty+amount)}audit(s,{sku,qty:amount,fromLocation:from,toLocation:to,type,refDoc,userId})}
export function audit(s,m){s.movements.push({...m,movementId:newId(),createdAt:now(),syncStatus:'PENDING'})}
export function enqueue(s,target,event,payload){s.queue.push({id:newId(),target,event,payload,status:'WAITING_CONFIGURATION',createdAt:now(),attempts:0})}
let dbPromise;
function openDB(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('wms38-device-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(r.error)}})}
export async function readState(){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),os=tx.objectStore('state'),r=os.get('main');let result;r.onsuccess=()=>{const prepared=prepareTestingState(r.result,seed),needsMigration=prepared!==r.result||!prepared.phase1Version||!prepared.settingsVersion||!prepared.cartLifecycleVersion||!prepared.resiVersion||!prepared.locationVersion;result=migrateState(prepared);if(needsMigration)os.put(result,'main')};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('Pembacaan data dibatalkan'))})}
export function applyMutation(state,fn){const result=migrateState(structuredClone(state));const outcome=fn(result);if(outcome&&typeof outcome.then==='function')throw Error('Transaksi stok harus diselesaikan secara atomik');result.revision=(state.revision||0)+1;result.lastSaved=now();return result}
export function latestState(current,incoming){return !current||(incoming.revision||0)>=(current.revision||0)?incoming:current}
export async function transact(fn){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),os=tx.objectStore('state');let result,failure;const r=os.get('main');r.onsuccess=()=>{try{result=applyMutation(prepareTestingState(r.result,seed),fn);os.put(result,'main')}catch(e){failure=e;tx.abort()}};tx.oncomplete=()=>{try{const bc=new BroadcastChannel('wms38');bc.postMessage('updated');bc.close()}catch{}resolve(result)};tx.onabort=tx.onerror=()=>reject(failure||tx.error||Error('Penyimpanan dibatalkan; tidak ada perubahan stok'))})}
