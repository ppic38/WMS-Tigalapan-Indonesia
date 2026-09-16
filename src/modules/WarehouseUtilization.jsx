import React from 'react';
import {Move,Warehouse} from 'lucide-react';
import {Button,num} from '../ui.jsx';
import {warehouseUtilization} from '../lib/warehouse-layout.js';
const percent=value=>value==null?'—':`${new Intl.NumberFormat('id-ID',{maximumFractionDigits:1}).format(value)}%`;
function Meter({value,label}){return <div className="space-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value==null?undefined:Math.min(100,value)} aria-valuetext={value==null?'Belum tersedia':percent(value)}><i style={{width:`${Math.max(0,Math.min(100,value||0))}%`}}/></div>}
export default function WarehouseUtilization({s,onOpenLayout,actionLabel='Atur tata letak'}){
 const u=warehouseUtilization(s);
 return <section className="space-utilization" aria-label="Monitoring utilisasi gudang"><header><div><Warehouse size={20}/><h2>Space utilization gudang</h2></div><span>Seluruh gudang · kondisi saat ini</span>{onOpenLayout&&<Button icon={Move} variant="secondary" onClick={onOpenLayout}>{actionLabel}</Button>}</header>
 <div className="space-metrics"><article className="space-primary"><span>Utilisasi lokasi</span><strong>{percent(u.locationPercent)}</strong><p>{num(u.occupied)} dari {num(u.locations)} lokasi aktif terisi</p><Meter value={u.locationPercent} label="Persentase lokasi terisi"/><small>{num(u.empty)} lokasi kosong · {num(u.blocked)} diblokir sementara</small></article>
 <article><span>Utilisasi kapasitas · pcs</span><strong>{percent(u.capacityPercent)}</strong><p>{num(u.used)} / {num(u.capacity)} pcs</p><Meter value={u.capacityPercent} label="Persentase kapasitas pcs terpakai"/><small>{u.unknown?`${num(u.unknown)} lokasi belum memiliki kapasitas; angka dihitung dari ${num(u.known)} lokasi.`:'Stok lokasi tercatat dibagi kapasitas penyimpanan.'}{u.capacityPercent>100&&' Isi melebihi kapasitas terdaftar.'}</small></article>
 <article><span>Luas lantai untuk rak</span><strong>{percent(u.areaPercent)}</strong><p>{u.areaPercent==null?'Ukuran aktual belum lengkap':`${num(u.rackArea)} / ${num(u.floorArea)} m²`}</p><Meter value={u.areaPercent} label="Persentase luas lantai ditempati rak"/><small>{u.areaPercent==null?(u.unplaced&&u.layoutConfigured?`${u.unplaced} rak baru perlu ditempatkan di layout.`:'Simpan ukuran gudang dan rak pada Atur tata letak.'):'Luas tapak rak ÷ luas gudang. Area lainnya termasuk lorong dan area kerja.'}</small></article></div>
 </section>;
}
