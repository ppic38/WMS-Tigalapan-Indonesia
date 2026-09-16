// Isolated synthetic component fixture, never included in the production build.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {seed,applyMutation} from '../src/lib/data.js';
import {createTestingState} from '../src/lib/testing-data.js';
import {importPackingList,receiveKoli,confirmKoliIntake,beginKoliCart,checkKoliItem,finishKoliCheck} from '../src/lib/phase1.js';
import {closeCheckingCart} from '../src/lib/carts.js';
import {startWork} from '../src/lib/productivity.js';
import LocationControl from '../src/modules/LocationControl.jsx';
import Putaway from '../src/modules/Putaway.jsx';
import Receiving from '../src/modules/Receiving.jsx';
const user='OP-IN-01';
function fixture(route){
 const s=createTestingState(seed());
 if(route==='putaway'){
  importPackingList(s,s.testing.packingRows,'resi-qa.csv',user);
  const receipt=s.receipts[0].internalResiNo;
  startWork(s,'RECEIVING',receipt,user);
  for(const k of s.kolis)receiveKoli(s,receipt,k.koliNo,user);
  confirmKoliIntake(s,receipt,user);
  for(const k of s.kolis.slice(0,2)){
   beginKoliCart(s,k.koliNo,'KRT-QA-001',user);
   for(const r of k.expectedItems)checkKoliItem(s,k.koliNo,r.sku,r.poNumber,r.qtyExpected,'GOOD',user,'KRT-QA-001');
   finishKoliCheck(s,k.koliNo,{},user);
  }
  closeCheckingCart(s,'KRT-QA-001',user);
 }
 return s;
}
function QA(){
 const route=new URLSearchParams(location.search).get('view')||'location-control';
 const [s,setS]=useState(()=>fixture(route)),[message,setMessage]=useState('');
 async function act(fn,text){try{const next=applyMutation(s,fn);setS(next);setMessage(text||'Tersimpan');return next}catch(e){setMessage(e.message);return false}}
 const props={s,act,user,accountId:'USER-ADMIN',notify:setMessage,navigate:()=>{}};
 return <div className={`app-shell ${route!=='location-control'?'operation-shell':''}`}><div className="main-shell" style={{marginLeft:0}}><header className="topbar"><strong>WMS38 · Uji komponen</strong></header><div className="operator-strip"><label>User uji <select aria-label="User uji"><option>Operator Inbound 01</option></select></label><small className="operation-mobile-note">Data sintetis</small></div><main className="workspace">{route==='location-control'?<LocationControl {...props} initial="map"/>:route==='putaway'?<Putaway {...props}/>:<Receiving {...props}/>}</main><output aria-label="Hasil aksi QA" style={{display:'block',padding:16}}>{message}</output><output aria-label="Stok tersimpan QA" style={{display:'block',padding:16}}>{s.stock.filter(r=>s.locations.find(l=>l.locationCode===r.locationCode)?.allocatable).reduce((n,r)=>n+r.qty,0)} pcs · {s.movements.filter(m=>m.type==='PUTAWAY').length} putaway</output></div></div>;
}
createRoot(document.getElementById('root')).render(<QA/>);
