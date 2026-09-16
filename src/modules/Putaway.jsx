import React,{useState,useRef,useEffect} from 'react';
import {ArrowRight} from 'lucide-react';
import {Button,PageHead,Panel,Table,Field,Notice,Product,num,ScanInput} from '../ui.jsx';
import {putawayFromCart,startCartPutaway,selectCartItem} from '../lib/phase1.js';
import {readyPutawayCarts,cartNumber,closedCartQueue} from '../lib/carts.js';
import WorkControl from '../WorkControl.jsx';
import {activeWork,startWork} from '../lib/productivity.js';
import {findItem,norm} from '../lib/data.js';
import {activePutawayLocation} from '../lib/locations.js';
import {OperationalDetails} from '../OperationalUI.jsx';
export default function Putaway({s,act,user}){
 const [cartNo,setCartNo]=useState(''),[runId,setRunId]=useState(''),[item,setItem]=useState(null),[last,setLast]=useState(null),[busy,setBusy]=useState(false),lock=useRef(false);
 const queue=closedCartQueue(s),carts=readyPutawayCarts(s),cart=carts.find(c=>c.cartNo===cartNo),work=activeWork(s,user),ready=work?.process==='PUTAWAY'&&work.reference==='STAGING',activeRun=s.cartRuns?.find(r=>r.status==='ACTIVE'&&r.userId===user);
 useEffect(()=>{if(cartNo&&!cart){setCartNo('');setRunId('');setItem(null)}},[s,cartNo]);
 useEffect(()=>{if(ready)document.getElementById(item?'putaway-qty':cartNo?'putaway-sku':'putaway-cart')?.focus()},[ready,cartNo,item?.requestId]);
 async function chooseCart(value){if(lock.current)return false;const code=cartNumber(value);lock.current=true;setBusy(true);try{const next=await act(d=>{startWork(d,'PUTAWAY','STAGING',user);startCartPutaway(d,code,user)},'Kereta siap diproses; pencatatan waktu dimulai');if(!next)return false;setCartNo(code);setRunId(next.cartRuns.find(r=>r.cartNo===code&&r.status==='ACTIVE').id);setItem(null);return true}finally{lock.current=false;setBusy(false)}}
 function chooseItem(code){if(lock.current)return false;if(!ready)throw Error('Klik Mulai kerja sebelum scan SKU');setItem({...selectCartItem(s,cartNo,code),runId,qty:''});return true}
 async function saveLocation(code){if(lock.current)return false;if(!item)throw Error('Scan SKU terlebih dahulu');lock.current=true;setBusy(true);const f={...item,to:norm(code)};try{const next=await act(d=>putawayFromCart(d,f,user),'Putaway tersimpan; stok, kereta, produktivitas, dan laporan diperbarui');if(!next)return false;const finished=!readyPutawayCarts(next).some(c=>c.cartNo===cartNo);setLast({...f,finished});setItem(null);if(finished){setCartNo('');setRunId('')}return true}finally{lock.current=false;setBusy(false)}}
 const destination=item?activePutawayLocation(s,item.sku):null;
 return <><PageHead title="Putaway" description="Mulai kerja → nomor kereta → SKU & qty → lokasi tujuan. Scan lokasi langsung menyimpan."/>
 <div className="operation-layout"><Panel title="Proses isi kereta" subtitle="Gunakan scanner, kamera, foto barcode/QR, atau ketik nomor."><WorkControl s={s} act={act} user={user} process="PUTAWAY" reference="STAGING" disabled={!carts.length}/>
 <div className="form-pad">{!cart&&<><div className="step-title"><span>1</span><h3>Kereta asal</h3></div>
 <ScanInput id="putaway-cart" label="Nomor kereta putaway" placeholder="Scan / input nomor kereta, lalu Enter" allowPhoto submitLabel="Buka kereta" disabled={!ready||busy} nextInputId="putaway-sku" onScan={chooseCart}/>
 {!ready&&<Notice>Mulai kerja, lalu scan atau pilih kereta.</Notice>}</>}
 {cart&&<><div className="location-selected"><strong className="mono">{cartNo}</strong><span>{cart.items.length} SKU · {num(cart.qty)} pcs tersisa</span><Button variant="secondary" disabled={busy} onClick={()=>{setItem(null);setCartNo('');setRunId('')}}>Lihat antrean</Button></div>
 {!item&&<><div className="step-title"><span>2</span><h3>Scan SKU</h3></div>
 <ScanInput key={cartNo} id="putaway-sku" label="SKU putaway" placeholder="Scan / input SKU dari kereta" allowPhoto submitLabel="Pilih SKU" disabled={!ready||busy} nextInputId="putaway-qty" onScan={chooseItem}/></>}
 {item&&<><div className="selected-product"><Product item={findItem(s,item.sku)}/><strong>{num(item.expectedQty)} pcs di kereta</strong><Button variant="secondary" disabled={busy} onClick={()=>setItem(null)}>Ganti SKU</Button></div>
 <Field id="putaway-qty" label="Qty putaway (pcs)" type="number" min="1" max={Math.min(item.expectedQty,destination?.free??item.expectedQty)} step="1" value={item.qty} disabled={!ready||busy} hint={`Ketik qty maksimal ${num(Math.min(item.expectedQty,destination?.free??item.expectedQty))} pcs.`} onChange={e=>setItem({...item,qty:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('putaway-location')?.focus()}}}/>

 <PutawayDestination destination={destination}/>
 <div className="step-title"><span>3</span><h3>Scan lokasi tujuan → tersimpan</h3></div>
 <ScanInput key={item.requestId} id="putaway-location" label="Lokasi tujuan putaway" placeholder={destination?`Scan lokasi ${destination.code}`:'Lokasi belum tersedia'} allowPhoto submitLabel="Simpan ke lokasi" disabled={!ready||busy||!destination} nextInputId="putaway-sku" onScan={saveLocation}/>
 <p className="muted operational-rule">Scan harus sama dengan satu lokasi yang ditampilkan sistem.</p></>}
 </>}
 {last&&<Notice tone="green">Tersimpan: {last.sku} · {num(last.qty)} pcs · {last.cartNo} → {last.to}.{last.finished&&' Semua item selesai. Kereta kosong dan dapat dipakai kembali di Receiving.'}</Notice>}</div></Panel>
 <div className="putaway-queue">{!cart&&<Panel title="Kereta siap putaway" subtitle={`${queue.length} kereta close · ${num(queue.reduce((n,c)=>n+c.qty,0))} pcs`}><Table mobileColumns={[0,1,2,3,4]} headers={['Nomor kereta',{label:'Jumlah SKU',type:'number'},{label:'Qty',type:'number'},'Status','Aksi']} empty={!queue.length} emptyText="Tidak ada kereta yang siap putaway">
 {queue.map(c=>{const owner=s.cartRuns.find(r=>r.cartNo===c.cartNo&&r.status==='ACTIVE');return <tr key={c.cartNo}><td className="mono strong">{c.cartNo}</td><td>{c.skuCount}</td><td>{num(c.qty)}</td><td>{owner?`Diproses · ${s.workers.find(w=>w.id===owner.userId)?.name||owner.userId}`:c.ready?'Close · Siap putaway':'Close · Menunggu penyelesaian cek / persetujuan selisih'}</td><td><Button variant="ghost" icon={ArrowRight} disabled={busy||!c.ready||Boolean(owner&&owner.userId!==user)||Boolean(activeRun&&activeRun.cartNo!==c.cartNo)} onClick={()=>chooseCart(c.cartNo)}>Buka kereta</Button></td></tr>})}</Table>
 <Notice>Hanya kereta berstatus Close yang tampil. Pilih Buka kereta untuk mulai Putaway. Kereta yang menunggu penyelesaian cek atau persetujuan selisih tetap terlihat, dan dapat diproses setelah siap. Kereta kosong otomatis hilang.</Notice></Panel>}
 {cart&&<OperationalDetails title={`Lihat isi kereta · ${cart.items.length} SKU`}><Panel title={`Isi ${cartNo}`} subtitle="Pilih atau scan SKU untuk mulai putaway."><Table mobileColumns={[0,1,2,3]} headers={['SKU / produk',{label:'Qty di kereta',type:'number'},'Lokasi utama','Aksi']} empty={!cart.items.length}>
 {cart.items.map(r=>{const product=findItem(s,r.sku);return <tr key={r.key}><td><Product item={product}/></td><td>{num(r.qty)}</td><td className="mono strong">{product?.primaryLocation||'Belum dipetakan'}</td><td><Button variant="ghost" disabled={!ready||busy} onClick={()=>chooseItem(r.sku)}>Pilih SKU</Button></td></tr>})}</Table></Panel></OperationalDetails>}</div></div></>;
}

export function PutawayDestination({destination}){
 return <section className="putaway-guidance" aria-label="Lokasi putaway aktif">
  <div className="putaway-primary"><span>{destination?.kind||'Utama/Reserve'}</span><div><strong>{destination?.code||'—'}</strong><b>{destination?.free==null?'—':num(destination.free)}</b></div></div>
 </section>;
}
