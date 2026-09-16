import React from 'react';
import assert from 'node:assert/strict';
import {renderToString} from 'react-dom/server';
import {UserManagement,RoleManagement,SystemSettings} from '../src/modules/Settings.jsx';
import {PreferencesContext} from '../src/preferences.jsx';
import {Table,ScanInput} from '../src/ui.jsx';
import Putaway from '../src/modules/Putaway.jsx';
import {seed} from '../src/lib/data.js';
const s=seed(),props={s,act:()=>{},user:'OP-IN-01',accountId:'USER-ADMIN'};
for(const [Component,title,columns] of [[UserManagement,'User Management',['Nama','Username','Email','Role','Operator','Status','Menu aktif','Aksi']],[RoleManagement,'Role Management',['Role','Peran persetujuan','Jumlah menu','User','Status','Aksi']],[SystemSettings,'Pengaturan Sistem',['Waktu (WITA)','User','Perubahan','Referensi']]]){
 const html=renderToString(<Component {...props}/>);assert(html.includes(title));for(const col of columns)assert(html.includes(`aria-label="Filter ${col}"`));
}
const html=renderToString(<Putaway {...props}/>);assert(html.includes('Tidak ada kereta yang siap putaway'));assert(!html.includes('Tanpa nomor kereta'));assert(!html.includes('aria-label="SKU putaway"'));assert(!html.includes('aria-label="Lokasi tujuan putaway"'));assert(html.includes('Foto barcode / QR'));
const scan=renderToString(<ScanInput onScan={()=>{}} label="Kereta" allowPhoto submitLabel="Buka kereta" disabled/>);assert(scan.includes('type="file"'));assert(scan.includes('accept="image/*"'));assert(scan.includes('disabled=""'));assert(scan.includes('Scan kamera Kereta'));
const table=renderToString(<PreferencesContext.Provider value={{tablePageSize:25}}><Table headers={['Item']}>{Array.from({length:30},(_,i)=><tr key={i}><td>{'Item '+(i+1)}</td></tr>)}</Table></PreferencesContext.Provider>);assert(table.includes('1–25 dari 30 data'));assert(table.includes('Item 25'));assert(!table.includes('Item 26'));
console.log('Settings render OK: 3 menus, all column filters, saved page size; Putaway gated steps and photo/manual controls');
