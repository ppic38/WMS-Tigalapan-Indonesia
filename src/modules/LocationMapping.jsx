import React,{useState} from 'react';
import {Plus,Trash2,Pencil,MapPin} from 'lucide-react';
import {Button,Field,Select,Modal,Notice,Table,Product,num} from '../ui.jsx';
import {isStorageLocation,locationCapacity,locationDistance,mappingValue,saveLocationMapping} from '../lib/locations.js';

export function AbcBadge({value}){return <span className={`abc-badge abc-${value||'none'}`}>{value||'Belum diisi'}</span>}
AbcBadge.filterValue=({value})=>value||'Belum diisi';
export function MappingFields({s,value,onChange,editAbc=true}){
 const locations=s.locations.filter(isStorageLocation).sort((a,b)=>a.locationCode.localeCompare(b.locationCode));
 const reserves=value.reserveLocations||[];
 const option=l=>{const c=locationCapacity(s,l.locationCode);return `${l.locationCode} · ${c.blocked?'Penuh sementara':c.free==null?'kapasitas belum diatur':`${num(c.free)} pcs kosong`}`};
 const ordered=[...locations].sort((a,b)=>value.primaryLocation?locationDistance(value.primaryLocation,a.locationCode)-locationDistance(value.primaryLocation,b.locationCode)||a.locationCode.localeCompare(b.locationCode):a.locationCode.localeCompare(b.locationCode));
 return <><div className="form-grid"><Field label={editAbc?'Klasifikasi ABC gudang':'ABC dari Master SKU'}>{editAbc?<Select value={value.abcClass||''} onChange={e=>onChange({...value,abcClass:e.target.value})}><option value="">Belum diisi</option>{['A','B','C'].map(c=><option key={c} value={c}>Kelas {c}</option>)}</Select>:<div className="abc-readonly"><AbcBadge value={value.abcClass}/><small>Perubahan kelas dilakukan di Master SKU.</small></div>}</Field><Field label="Lokasi utama"><Select value={value.primaryLocation||''} onChange={e=>onChange({...value,primaryLocation:e.target.value})}><option value="">Belum dipetakan</option>{locations.map(l=><option key={l.locationCode} value={l.locationCode}>{option(l)}</option>)}</Select></Field></div>
 <div className="reserve-editor"><div className="reserve-editor-head"><h3>Lokasi reserve</h3><Button type="button" icon={Plus} variant="secondary" disabled={!value.primaryLocation||reserves.length>=locations.length-1} onClick={()=>onChange({...value,reserveLocations:[...reserves,'']})}>Tambah reserve</Button></div>
 {!reserves.length&&<p className="muted">Belum ada lokasi cadangan untuk SKU ini.</p>}
 {reserves.map((code,i)=><div className="reserve-edit-row" key={i}><Field label={`Reserve ${i+1}`}><Select required value={code} onChange={e=>onChange({...value,reserveLocations:reserves.map((c,j)=>i===j?e.target.value:c)})}><option value="">Pilih lokasi reserve</option>{ordered.filter(l=>l.locationCode!==value.primaryLocation&&(l.locationCode===code||!reserves.includes(l.locationCode))).map(l=><option key={l.locationCode} value={l.locationCode}>{option(l)}</option>)}</Select></Field><Button type="button" icon={Trash2} variant="ghost" aria-label={`Hapus reserve ${i+1}`} onClick={()=>onChange({...value,reserveLocations:reserves.filter((_,j)=>j!==i)})}>Hapus</Button></div>)}
 <p className="muted">Reserve direkomendasikan berdasarkan zona, rak, bin, lalu level relatif terhadap lokasi utama. Kapasitas dipakai bersama oleh seluruh SKU dalam lokasi.</p></div></>;
}
export function LocationMappingEditor({s,act,item,onClose,accountId,menu='location-control',selectable=false}){
 const [sku,setSku]=useState(item?.sku||s.items[0]?.sku||'');
 const initial=mappingValue(item||s.items[0]);
 const [value,setValue]=useState(initial),[expected,setExpected]=useState(initial),[busy,setBusy]=useState(false);
 return <Modal wide title="Mapping lokasi SKU" subtitle="Lokasi utama, reserve, dan kelas ABC tersimpan di Master SKU." onClose={onClose}><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{const next=await act(d=>saveLocationMapping(d,{sku,...value,expected},accountId,menu),'Mapping tersimpan. Panduan Putaway dan peta ABC diperbarui.');if(next)onClose()}finally{setBusy(false)}}}>
 {selectable?<Field label="SKU"><Select value={sku} onChange={e=>{const selected=s.items.find(i=>i.sku===e.target.value),v=mappingValue(selected);setSku(selected.sku);setValue(v);setExpected(v)}}>{s.items.map(i=><option key={i.sku} value={i.sku}>{i.sku} · {i.itemName}</option>)}</Select></Field>:<div className="mapping-product"><Product item={item}/></div>}
 <MappingFields s={s} value={value} onChange={setValue} editAbc={menu==='master'}/>
 <Notice tone="blue">Mapping menentukan panduan penyimpanan. Barang yang sudah tersimpan tetap tercatat di lokasi fisiknya.</Notice>
 <div className="modal-actions"><Button type="button" variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" icon={MapPin} disabled={busy}>{busy?'Menyimpan…':'Simpan mapping'}</Button></div>
 </form></Modal>;
}
export function ReserveTable({s,items,onEdit}){
 const rows=items.flatMap(i=>(i.reserveLocations||[]).map(code=>({item:i,...locationCapacity(s,code)})));
 return <Table headers={['SKU / produk','ABC gudang','Lokasi utama','Lokasi reserve',{label:'Isi lokasi (pcs)',type:'number'},{label:'Sisa kapasitas (pcs)',type:'number'},'Status lokasi','Aksi']} exportFilename="master-reserve.csv" empty={!rows.length} emptyText="Belum ada lokasi reserve. Tambahkan mapping untuk SKU.">
 {rows.map(r=><tr key={`${r.item.sku}|${r.code}`}><td><Product item={r.item}/></td><td><AbcBadge value={r.item.abcClass}/></td><td className="mono">{r.item.primaryLocation||'—'}</td><td className="mono strong">{r.code}</td><td data-filter-value={r.used}>{num(r.used)}</td><td data-filter-value={r.free??''}>{r.free==null?'Belum diatur':num(r.free)}</td><td>{r.status}</td><td><Button icon={Pencil} variant="ghost" onClick={()=>onEdit(r.item)}>Mapping</Button></td></tr>)}
 </Table>;
}
