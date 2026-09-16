import React,{useState} from 'react';
import {Button,Field,Modal,Notice,Table,num} from '../ui.jsx';
import {storageRacks,rackStructureVersion,planRackStructure,resizeRackStructure} from '../lib/warehouse-layout.js';

export default function RackStructureEditor({s,rack,act,accountId,onClose,onSaved}){
 const [form,setForm]=useState(()=>{const current=storageRacks(s).find(r=>r.id===rack);return {rack,levels:Math.max(...current.levels.map(Number)),bins:Math.max(...current.bins.map(Number)),capacity:current.cells.find(l=>l.capacity>0)?.capacity||'',expected:rackStructureVersion(s,rack)}}),[busy,setBusy]=useState(false);
 let plan,error='';try{plan=planRackStructure(s,form)}catch(e){error=e.message}
 const changed=plan&&(plan.added.length+plan.retired.length+plan.restored.length)>0,blocked=new Map((plan?.blocked||[]).map(r=>[r.code,r.reasons.join('; ')]));
 const rows=plan?[...plan.added.map(code=>({code,action:'Tambah',note:'Lokasi baru'})),...plan.restored.map(code=>({code,action:'Pulihkan',note:'Kapasitas lama dipertahankan'})),...plan.retired.map(code=>({code,action:blocked.has(code)?'Tertahan':'Nonaktifkan',note:blocked.get(code)||'Riwayat lokasi tetap tersedia'}))]:[];
 async function save(e){
  e.preventDefault();if(busy||!plan||plan.blocked.length||!changed)return;
  setBusy(true);
  try{const next=await act(d=>resizeRackStructure(d,form,accountId),'Jumlah bin dan level tersimpan. Master lokasi dan peta 3D diperbarui.');if(next){onSaved?.(next);onClose()}}
  finally{setBusy(false)}
 }
 return <Modal wide title={`Ubah bin & level · Rak ${rack}`} subtitle="Atur jumlah level dan bin pada rak yang sudah ada." onClose={()=>{if(!busy)onClose()}}><form onSubmit={save}>
 <div className="form-grid"><Field label="Jumlah level" type="number" min="1" max="9" step="1" required disabled={busy} value={form.levels} onChange={e=>setForm({...form,levels:e.target.value})}/><Field label="Jumlah bin per level" type="number" min="1" max="99" step="1" required disabled={busy} value={form.bins} onChange={e=>setForm({...form,bins:e.target.value})}/></div>
 <p className="rack-structure-note">Level dimulai dari 1 dan bin dari 01 di setiap level. Ukuran fisik rak dalam meter tetap mengikuti pengaturan tata letak.</p>
 {error?<Notice tone="red">{error}</Notice>:<><div className="rack-structure-summary"><strong>{num(plan.total)} lokasi pada rak</strong><span>{plan.added.length} baru · {plan.restored.length} dipulihkan · {plan.retired.length} dinonaktifkan</span></div>
 {plan.added.length>0&&<Field label="Kapasitas setiap lokasi baru (pcs)" type="number" min="1" step="1" required disabled={busy} value={form.capacity} onChange={e=>setForm({...form,capacity:e.target.value})}/>}
 {plan.blocked.length>0&&<Notice tone="red">{plan.blocked.length} lokasi masih digunakan. Selesaikan pekerjaan, pindahkan stok atau ubah mapping SKU yang tercantum di bawah sebelum mengurangi rak.</Notice>}
 {changed?<Table headers={['Lokasi','Perubahan','Keterangan']} mobileColumns={[0,1,2]}>{rows.map(row=><tr key={row.code}><td className="mono strong">{row.code}</td><td>{row.action}</td><td>{row.note}</td></tr>)}</Table>:<Notice>Jumlah bin dan level masih sama dengan struktur yang tersimpan.</Notice>}
 {plan.retired.length>0&&!plan.blocked.length&&<Notice>Lokasi di luar jumlah baru akan dinonaktifkan. Riwayatnya tetap disimpan dan lokasinya bisa dipulihkan dengan menambah kembali bin atau level.</Notice>}
 </>}
 <div className="modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button><Button type="submit" disabled={busy||!!error||!changed||!!plan?.blocked.length}>{busy?'Menyimpan…':'Simpan bin & level'}</Button></div>
 </form></Modal>;
}
