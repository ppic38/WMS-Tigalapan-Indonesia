import React,{useMemo,useState} from 'react';
import {Eye,Printer} from 'lucide-react';
import {Button,PageHead,Panel,Table,Field,Select,SearchBox,Notice,Modal,num} from '../ui.jsx';
import {processHistory,reportTypes,filterHistory,reportTime} from '../lib/reports.js';
import {printLabels} from '../lib/files.js';

export default function Reports({s,initialReport='receiving'}){
 const [type,setType]=useState(initialReport),[start,setStart]=useState(''),[end,setEnd]=useState(''),[query,setQuery]=useState(''),[selected,setSelected]=useState('');
 const history=useMemo(()=>processHistory(s),[s]),all=history[type]||[],rows=filterHistory(all,{start,end,query}),entry=all.find(r=>r.key===selected);
 const title=reportTypes.find(([id])=>id===type)?.[1]||'Riwayat proses',invalid=start&&end&&start>end;
 return <><PageHead title="Laporan" description="Riwayat proses gudang, rincian barang, dan petugas yang tercatat."/>
 <Panel><div className="report-controls"><Field label="Jenis laporan"><Select value={type} onChange={e=>{setType(e.target.value);setSelected('')}}>{reportTypes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></Field><Field label="Dari tanggal (WITA)" type="date" value={start} onChange={e=>setStart(e.target.value)}/><Field label="Sampai tanggal (WITA)" type="date" value={end} onChange={e=>setEnd(e.target.value)}/><Button variant="ghost" onClick={()=>{setStart('');setEnd('')}}>Semua periode</Button></div>
 {invalid&&<Notice tone="red">Tanggal awal tidak boleh melewati tanggal akhir.</Notice>}
 <div className="toolbar"><SearchBox value={query} onChange={setQuery} placeholder="Cari dokumen, koli, SKU, kereta, atau petugas…"/><span className="muted">{num(rows.length)} catatan · {title}</span></div>
 <Table key={type} resetKey={`${start}|${end}|${query}`} exportFilename={`laporan-${type}.csv`} headers={['Waktu tercatat (WITA)','Dokumen','Referensi','Vendor / cabang',{label:'Line item',type:'number'},{label:'Qty',type:'number'},'Satuan','Status','Petugas',{label:'Detail',export:false}]} empty={!rows.length}>
 {rows.map(r=><tr key={r.key}><td>{reportTime(r.at)}</td><td className="mono strong">{r.document}</td><td>{r.reference||'—'}</td><td>{r.party||'—'}</td><td data-filter-value={r.lineCount}>{num(r.lineCount)}</td><td className="number strong" data-filter-value={r.qty}>{r.qty==null?'—':num(r.qty)}</td><td>{r.unit||'—'}</td><td>{r.status}</td><td>{r.operator||'—'}</td><td><Button variant="ghost" icon={Eye} onClick={()=>setSelected(r.key)}>Detail</Button></td></tr>)}
 </Table></Panel>
 {entry&&<Modal wide title={`${title} · ${entry.document}`} onClose={()=>setSelected('')}><ReportDetails entry={entry}/></Modal>}
 </>;
}

export function ReportDetails({entry:r}){
 return <><div className="report-detail-summary"><span>{r.status}</span>{r.labels?.length>0&&<Button icon={Printer} variant="secondary" onClick={()=>printLabels(r.labels)}>Cetak label koli</Button>}</div>
 <dl className="report-meta">{[['Waktu tercatat (WITA)',reportTime(r.at)],['Referensi',r.reference||'—'],['Vendor / cabang',r.party||'—'],['Petugas',r.operator||'—'],...r.meta].map(([label,value],i)=><div key={i}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl>
 <Table headers={r.headers} exportFilename={`detail-${r.document}.csv`} empty={!r.rows.length}>{r.rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j} data-filter-value={value??''}>{value??'—'}</td>)}</tr>)}</Table>
 {(r.extraTables||[]).map((table,i)=><div className="report-extra-table" key={i}><h3>{table.title}</h3><Table headers={table.headers} exportFilename={`rincian-${r.document}-${i+1}.csv`} empty={!table.rows.length}>{table.rows.map((row,index)=><tr key={index}>{row.map((value,j)=><td key={j} data-filter-value={value??''}>{value??'—'}</td>)}</tr>)}</Table></div>)}
 </>;
}
