export const reportTypes=[
 ['packing_lists','Data resi vendor'],['receiving','Penerimaan koli'],['checking','Pengecekan isi koli'],
 ['carts','Close kereta receiving'],['putaway','Putaway'],['picking','Picking'],['packing','Packing'],['shipping','Shipping'],
 ['allocation','Alokasi cabang'],['opname','Stock opname'],['returns','Retur barang'],['approvals','Persetujuan'],['movements','Pergerakan stok'],['location_control','Location control']
];
const statusLabels={CLOSED:'Selesai',FINISHED:'Selesai',CANCELLED:'Dibatalkan',CONFIRMED:'Dikonfirmasi',APPROVED:'Disetujui',REJECTED:'Ditolak',PENDING_SPV:'Menunggu SPV',PENDING_MANAGER:'Menunggu Manager',NON_SELLABLE:'Non-sellable',SELLABLE:'Layak jual',DISCREPANCY:'Ada selisih',READY_TO_CHECK:'Siap cek isi',AWAITING_KOLI:'Menunggu penerimaan',RECEIVING_KOLI:'Penerimaan berlangsung',CHECKING:'Pengecekan berlangsung',PENDING:'Menunggu',GOOD:'Baik',DAMAGED:'Rusak',REJECT:'Reject'};
const label=value=>statusLabels[value]||value||'—';
const sum=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
const unique=values=>[...new Set(values.filter(Boolean))].join(', ');
const numeric=label=>({label,type:'number'});
export function reportDay(at){if(!at||!Number.isFinite(Date.parse(at)))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))}
export function reportTime(at){if(!reportDay(at))return '—';return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'}).format(new Date(at))}

export function processHistory(s){
 const result=Object.fromEntries(reportTypes.map(([id])=>[id,[]]));
 const receiptMap=new Map(s.receipts.map(r=>[r.internalResiNo,r]));
 const worker=id=>s.workers?.find(w=>w.id===id)?.name||id||'—';
 const store=id=>s.stores.find(st=>st.storeId===id)?.storeName||id||'';
 const work=(process,reference)=>s.workSessions?.filter(w=>w.process===process&&w.reference===reference)||[];
 const operators=(process,reference,fallback)=>unique(work(process,reference).map(w=>w.userName||worker(w.userId)))||worker(fallback);
 const ended=(process,reference)=>work(process,reference).map(w=>w.closedAt).filter(Boolean).sort().at(-1)||'';
 const movements=(type,reference)=>s.movements.filter(m=>m.type===type&&m.refDoc===reference);
 const add=(type,row)=>result[type].push({party:'',reference:'',operator:'—',lineCount:0,qty:null,unit:'pcs',meta:[],...row,key:`${type}:${row.id}`});
 for(const event of s.locationAudit||[]){
  if(event.action==='Struktur rak'){add('location_control',{id:event.id,at:event.at,document:event.reference,reference:event.action,operator:event.actor,status:'Tersimpan',unit:'lokasi',qty:event.after.length,headers:['Lokasi','Perubahan',numeric('Kapasitas (pcs)')],rows:event.after.map(l=>[l.locationCode,l.layoutRetired?'Dinonaktifkan':event.before.some(old=>old.locationCode===l.locationCode)?'Dipulihkan':'Ditambahkan',l.capacity])});continue;}
  if(event.action==='Tambah lokasi'){add('location_control',{id:event.id,at:event.at,document:event.reference,reference:event.action,operator:event.actor,status:'Tersimpan',unit:'lokasi',qty:event.after.length,headers:['Lokasi',numeric('Kapasitas (pcs)')],rows:event.after.map(l=>[l.locationCode,l.capacity])});continue;}
  if(event.action==='Layout gudang'){
   const before=event.before||{},after=event.after||{},size=w=>w?`${w.width} × ${w.depth} m`:'Belum diatur',rack=r=>r?`X ${r.x}, Y ${r.y} m · ${r.width} × ${r.depth} × ${r.height} m · ${r.rotation}°`:'Belum diatur';
   const ids=[...new Set([...(before.racks||[]),...(after.racks||[])].map(r=>r.id))];
   add('location_control',{id:event.id,at:event.at,document:event.reference,reference:event.action,operator:event.actor,status:'Tersimpan',unit:'',headers:['Pengaturan','Sebelum','Sesudah'],rows:[['Ukuran gudang',size(before.warehouse),size(after.warehouse)],...ids.map(id=>[`Rak ${id}`,rack(before.racks?.find(r=>r.id===id)),rack(after.racks?.find(r=>r.id===id))])]});
   continue;
  }
  const fields=event.action==='Mapping SKU'?[['abcClass','ABC gudang'],['primaryLocation','Lokasi utama'],['reserveLocations','Lokasi reserve']]:[['capacity','Kapasitas (pcs)'],['putawayBlocked','Penuh sementara']];
  const value=v=>Array.isArray(v)?v.join(', ')||'—':typeof v==='boolean'?(v?'Ya':'Tidak'):v??'—';
  add('location_control',{id:event.id,at:event.at,document:event.reference,reference:event.action,operator:event.actor,status:'Tersimpan',unit:'',headers:['Pengaturan','Sebelum','Sesudah'],rows:fields.map(([key,label])=>[label,value(event.before[key]),value(event.after[key])])});
 }
 const manifest=ks=>ks.flatMap(k=>k.expectedItems.map(l=>[k.vendorKoliNo||k.koliNo,k.koliNo,l.sku,l.poNumber,l.qtyExpected]));
 const manifestHeaders=['Koli vendor','Label WMS','SKU','PO / referensi',numeric('Qty sesuai resi')];
 for(const p of s.packingLists||[]){
  const r=receiptMap.get(p.receiptId),ks=s.kolis.filter(k=>k.internalResiNo===p.receiptId);
  add('packing_lists',{id:p.receiptId,at:p.uploadedAt,document:r?.externalResiNo||p.externalResiNo||p.receiptId,reference:r?.externalResiNo||p.receiptId,party:p.vendorName,operator:worker(p.uploadedBy),lineCount:p.lineCount,qty:p.totalQty,status:'Upload selesai',meta:[['File',p.filename],['Jumlah koli',p.totalKoli],['Proses kiriman',label(r?.status)]],headers:manifestHeaders,rows:manifest(ks),labels:ks.map(k=>({code:k.koliNo,label:k.vendorKoliNo||k.koliNo}))});
 }
 for(const k of s.kolis){
  const r=receiptMap.get(k.internalResiNo),common={id:k.koliNo,document:k.vendorKoliNo||k.koliNo,reference:r?.externalResiNo||k.internalResiNo,party:r?.vendorName||'',meta:[['Label WMS',k.koliNo],['Resi vendor',r?.externalResiNo||'—'],['Ekspedisi',r?.expedition||'—']],labels:[{code:k.koliNo,label:k.vendorKoliNo||k.koliNo}]};
  if(k.arrivedAt)add('receiving',{...common,at:k.arrivedAt,operator:worker(k.arrivedBy),lineCount:k.expectedItems.length,qty:1,unit:'koli',status:r?.intakeConfirmedAt?'Diterima · kiriman dikonfirmasi':'Diterima · menunggu konfirmasi kiriman',headers:manifestHeaders,rows:manifest([k]),meta:[...common.meta,['Konfirmasi kiriman',reportTime(r?.intakeConfirmedAt)]]});
  if(k.closedAt||['CLOSED','DISCREPANCY'].includes(k.status)){
   const lines=k.closedLines||[],approval=s.approvals.find(a=>a.type==='RECEIVING'&&a.refDoc===k.koliNo),hasVariance=lines.some(l=>l.discrepancy);
   add('checking',{...common,at:k.closedAt||'',operator:operators('CHECKING',k.koliNo,movements('RECEIVE',k.koliNo)[0]?.userId),lineCount:lines.length,qty:sum(lines,'received'),status:hasVariance?`Cek selesai · ${approval?label(approval.status).toLowerCase():'ada selisih'}`:'Cek selesai · sesuai',headers:['SKU','PO / referensi',numeric('Qty sesuai resi'),numeric('Fisik'),numeric('Selisih'),numeric('Rusak / reject'),'Kereta','Alasan'],rows:lines.map(l=>[l.sku,l.poNumber,l.expected,l.received,l.variance,l.bad,unique(k.scannedItems.filter(row=>row.sku===l.sku&&row.poNumber===l.poNumber).map(row=>row.cartNo||'Belum dicatat')),l.reason||'—']),extraTables:[{title:'Hasil scan per kereta',headers:['Nomor kereta','SKU','PO / referensi',numeric('Qty scan'),'Kondisi'],rows:k.scannedItems.map(row=>[row.cartNo||'Belum dicatat',row.sku,row.poNumber,row.qtyScanned,label(row.condition)])}]});
  }
 }
 for(const c of s.checkingCarts||[])if(c.closedAt)add('carts',{id:c.id,at:c.closedAt,document:c.cartNo,reference:unique((c.closedItems||[]).map(r=>r.koliNo)),operator:worker(c.closedBy),lineCount:c.closedSkuCount||0,qty:c.closedQty||0,status:c.status==='FINISHED'?'Putaway selesai / kereta kosong':'Close',meta:[['Mulai pengisian',reportTime(c.openedAt)],['Close kereta',reportTime(c.closedAt)],['Putaway selesai',reportTime(c.finishedAt)],['Jumlah koli',c.closedKoliCount||0]],headers:['Koli vendor','SKU','PO / referensi',numeric('Qty saat close')],rows:(c.closedItems||[]).map(r=>[r.koliNo,r.sku,r.poNumber,r.qty])});
 for(const m of s.movements){
  const row={id:m.movementId,at:m.createdAt,document:m.refDoc,reference:m.sku,operator:worker(m.userId),lineCount:1,qty:m.qty,status:'Tercatat',headers:['SKU',numeric('Qty'),'Dari','Ke','Nomor kereta','Aktivitas'],rows:[[m.sku,m.qty,m.fromLocation||'—',m.toLocation||'—',m.cartNo||'—',m.type]]};
  add('movements',{...row,reference:`${m.type} · ${m.sku}`,meta:[['Aktivitas',m.type],['Nomor kereta',m.cartNo||'—']]});
  if(m.type==='PUTAWAY')add('putaway',{...row,status:'Selesai',meta:[['Nomor kereta',m.cartNo||'Belum dicatat']]});
 }
 for(const b of s.pickBatches||[]){
  if(!['FINISHED','CANCELLED'].includes(b.status))continue;
  add('picking',{id:b.id,at:b.finishedAt||ended('PICKING',b.id),document:b.id,reference:b.pickIds.join(', '),party:unique(b.tasks.map(t=>store(t.storeId))),operator:worker(b.assigneeId),lineCount:b.tasks.length,qty:sum(b.tasks,'pickedQty'),status:label(b.status),headers:['Picking list','Cabang','SKU','Lokasi',numeric('Qty tugas'),numeric('Qty diambil'),numeric('Short-pick'),'Status'],rows:b.tasks.map(t=>[t.pickId,store(t.storeId),t.sku,t.location,t.qty,t.pickedQty,t.shortQty||0,label(t.status)]),meta:[['Lokasi awal',b.startLocation],['Kereta',b.cartNo||'—'],['Kapasitas batch (pcs)',b.capacity||'—']]});
 }
 for(const p of s.picks.filter(p=>p.outboundVersion!==2&&!p.batchId&&['PICKED','PACKED','SHIPPED','CANCELLED'].includes(p.status))){
  const logged=movements('PICK',p.id);
  add('picking',{id:p.id,at:logged.at(-1)?.createdAt||'',document:p.id,reference:p.allocationNo,party:store(p.storeId),operator:unique(logged.map(m=>worker(m.userId))),lineCount:p.lines.length,qty:sum(p.lines,'pickedQty'),status:p.status==='CANCELLED'?'Dibatalkan':'Selesai',headers:['SKU',numeric('Qty tugas'),numeric('Qty diambil'),'Lokasi'],rows:p.lines.map(l=>[l.sku,l.qty,l.pickedQty,unique(l.sources.map(x=>x.location))]),meta:[['Waktu riwayat lama','Waktu pengambilan terakhir yang tercatat']]});
 }
 for(const o of s.orders){
  if(o.outboundVersion===2){
   const k=s.packingKolis?.find(k=>k.koliNo===o.koliNo),common={id:o.doNumber,reference:(o.batchIds||[]).join(', '),party:store(o.storeId),lineCount:o.lines.length,qty:sum(o.lines,'qty'),headers:['SKU',numeric('Qty'),'Batch','Kereta','Lokasi asal','Picking list'],rows:o.lines.map(l=>[l.sku,l.qty,l.batchId,l.cartNo,l.location,l.pickId]),meta:[['Koli',o.koliNo],['Surat jalan',o.doNumber],['Picking list',(o.pickingListIds||[]).join(', ')]],labels:[{code:o.koliNo,label:o.koliNo}]};
   add('packing',{...common,at:o.createdAt,document:o.koliNo,operator:worker(k?.ownerId),status:'Packing selesai'});
   if(o.status==='SHIPPED')add('shipping',{...common,at:o.shippedAt,document:o.doNumber,operator:unique(movements('SHIP',o.doNumber).map(m=>worker(m.userId))),status:'Terkirim'});
   continue;
  }
  const p=s.picks.find(p=>p.id===o.pickingListId),common={id:o.doNumber,reference:o.doNumber,party:store(o.storeId),lineCount:o.lines.length,qty:sum(o.lines,'qty'),headers:['SKU',numeric('Qty'),'Lokasi pengambilan'],rows:o.lines.map(l=>[l.sku,l.qty,unique((l.sources||[]).map(x=>x.location))]),meta:[['Surat jalan',o.doNumber],['Picking list',o.pickingListId]]};
  add('packing',{...common,at:o.createdAt,document:o.pickingListId,operator:operators('PACKING',o.pickingListId),status:'Packing selesai'});
  if(o.status==='SHIPPED')add('shipping',{...common,at:o.shippedAt||'',document:o.doNumber,reference:o.pickingListId,operator:unique(movements('SHIP',o.doNumber).map(m=>worker(m.userId)))||'—',status:'Terkirim'});
 }
 for(const a of s.allocations.filter(a=>['CONFIRMED','CANCELLED'].includes(a.status)))add('allocation',{id:a.allocationNo,at:a.createdAt,document:a.allocationNo,reference:a.period,party:unique(a.lines.map(l=>store(l.storeId))),operator:worker(a.createdBy),lineCount:a.lines.length,qty:sum(a.lines,'allocatedQty'),status:label(a.status),headers:['SKU','Cabang',numeric('SOQ'),numeric('Alokasi'),numeric('Terkirim'),'Alasan override'],rows:a.lines.map(l=>[l.sku,store(l.storeId),l.soq,l.allocatedQty,l.shippedQty||0,l.overrideReason||'—']),meta:[['Metode',a.method],['Waktu','Tanggal pembuatan dokumen; jumlah mengikuti perubahan alokasi tercatat']]});
 for(const c of s.counts.filter(c=>c.physicalQty!=null)){
  const a=s.approvals.find(a=>a.type==='OPNAME'&&a.refDoc===c.id);
  add('opname',{id:c.id,at:c.createdAt,document:c.id,reference:c.locationCode,operator:worker(a?.createdBy),lineCount:1,qty:c.physicalQty,status:`Hitung selesai · ${label(a?.status||c.status).toLowerCase()}`,headers:['SKU','Lokasi',numeric('Qty sistem'),numeric('Qty fisik'),numeric('Selisih'),'Catatan'],rows:[[c.sku,c.locationCode,c.systemQty,c.physicalQty,c.variance,c.reason]]});
 }
 for(const r of s.returns)add('returns',{id:r.id,at:r.createdAt,document:r.id,reference:r.sku,party:store(r.storeId),operator:worker(movements('RETURN',r.id)[0]?.userId),lineCount:1,qty:r.qty,status:label(r.status),headers:['SKU',numeric('Qty'),'Kategori retur','Catatan','Lokasi tujuan'],rows:[[r.sku,r.qty,r.returnReason,r.notes||'—',r.targetLocation||'R01-1-01']]});
 for(const a of s.approvals)for(const [i,h] of (a.history||[]).entries())add('approvals',{id:`${a.id}:${i}`,at:h.createdAt,document:a.refDoc,reference:a.type,operator:worker(h.userId),unit:'',status:`${h.role} · ${label(h.decision)}`,headers:['Jenis','Peran','Keputusan','Catatan'],rows:[[a.type,h.role,label(h.decision),h.reason]]});
 for(const rows of Object.values(result))rows.sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||a.key.localeCompare(b.key));
 return result;
}

export function filterHistory(rows,{start='',end='',query=''}={}){
 if(start&&end&&start>end)return [];
 const search=query.trim().toLowerCase();
 return rows.filter(r=>{const day=reportDay(r.at);if(start&&(!day||day<start)||end&&(!day||day>end))return false;
  return !search||[r.document,r.reference,r.party,r.operator,r.status,...r.meta.flat(),...r.rows.flat(),...(r.extraTables||[]).flatMap(t=>t.rows.flat())].join(' ').toLowerCase().includes(search);
 });
}
