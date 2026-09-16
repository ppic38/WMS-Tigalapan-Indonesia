import {newId,now} from './data.js';
export const menuCatalog=[['dashboard','Ringkasan gudang'],['inventory','Persediaan'],['receiving','Receiving'],['putaway','Putaway'],['allocation','Alokasi cabang'],['picking','Batch picking'],['packing','Packing'],['shipping','Shipping'],['location-control','Location control'],['opname','Stock opname'],['returns','Retur barang'],['approvals','Persetujuan'],['master','Master data'],['workforce','Tim & operator'],['reports','Laporan'],['sync','Integrasi'],['settings-users','User Management'],['settings-roles','Role Management'],['settings-system','Pengaturan Sistem']];
const allMenus=menuCatalog.map(([id])=>id);
export function initializeSettings(s){
 s.roles??=[{id:'ADMIN',name:'Administrator',active:true,menus:[...allMenus],approvalRole:'SPV'},
  {id:'INBOUND',name:'Operator Inbound',active:true,menus:['dashboard','inventory','receiving','putaway','reports'],approvalRole:'OPERATOR'},
  {id:'OUTBOUND',name:'Operator Outbound',active:true,menus:['dashboard','inventory','picking','packing','shipping','reports'],approvalRole:'OPERATOR'},
  {id:'SPV',name:'Supervisor',active:true,menus:allMenus.filter(id=>!id.startsWith('settings-')&&id!=='sync'),approvalRole:'SPV'},
  {id:'MANAGER',name:'Manager',active:true,menus:allMenus.filter(id=>!id.startsWith('settings-')),approvalRole:'MANAGER'}];
 s.appUsers??=[{id:'USER-ADMIN',name:'Administrator',username:'admin',email:'',roleId:'ADMIN',workerId:s.workers[0]?.id||'',active:true,menuOverrides:{}},...s.workers.map((w,i)=>({id:`USER-${w.id}`,name:w.name,username:`operator${i+1}`,email:'',roleId:w.teamId==='OUTBOUND'?'OUTBOUND':'INBOUND',workerId:w.id,active:w.active,menuOverrides:{}}))];
 s.systemSettings??={companyName:'Tigalapan Indonesia',warehouseName:'Gudang Tigalapan',landingPage:'dashboard',tablePageSize:15};
 s.settingsAudit??=[];s.settingsVersion=1;return s;
}
export const canonicalMenu=id=>id==='activity'?'reports':id;
export function effectiveMenus(s,id){
 const u=s.appUsers?.find(u=>u.id===id&&u.active),r=s.roles?.find(r=>r.id===u?.roleId&&r.active);
 if(!u||!r)return [];if(r.id==='ADMIN')return [...allMenus];
 return allMenus.filter(key=>u.menuOverrides?.[key]===true||(u.menuOverrides?.[key]!==false&&r.menus.includes(key)));
}
export const canAccess=(s,id,menu)=>effectiveMenus(s,id).includes(canonicalMenu(menu));
export function requireMenu(s,id,menu){if(!canAccess(s,id,menu))throw Error('User ini tidak memiliki akses ke menu tersebut');}
function log(s,actor,action,reference){s.settingsAudit.push({id:newId(),at:now(),actor:s.appUsers.find(u=>u.id===actor)?.name||actor,action,reference})}
export function saveAppUser(s,f,actor){
 requireMenu(s,actor,'settings-users');const old=f.id?s.appUsers.find(u=>u.id===f.id):null;
 if(f.id&&!old)throw Error('User tidak ditemukan');const name=String(f.name||'').trim(),username=String(f.username||'').trim().toLowerCase(),email=String(f.email||'').trim();
 if(!name||!/^[-a-z0-9._]{3,40}$/.test(username))throw Error('Nama wajib diisi; username 3–40 karakter huruf, angka, titik, garis bawah atau tanda hubung');
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Email tidak valid');
 if(s.appUsers.some(u=>u.id!==f.id&&u.username===username))throw Error('Username sudah digunakan');
 if(!s.roles.some(r=>r.id===f.roleId&&r.active))throw Error('Pilih role aktif');
 if(!s.workers.some(w=>w.id===f.workerId&&w.active))throw Error('Pilih operator aktif untuk pencatatan produktivitas');
 if(old?.roleId==='ADMIN'&&old.active&&(!f.active||f.roleId!=='ADMIN')&&!s.appUsers.some(u=>u.id!==old.id&&u.roleId==='ADMIN'&&u.active))throw Error('Minimal satu Administrator aktif harus dipertahankan');
 if(old&&(old.workerId!==f.workerId||old.roleId!==f.roleId||!f.active)&&s.workSessions.some(w=>w.userId===old.workerId&&w.status==='RUNNING'))throw Error('Jeda pekerjaan user sebelum mengganti operator, role, atau menonaktifkan');
 const overrides=Object.fromEntries(Object.entries(f.menuOverrides||{}).filter(([key,value])=>allMenus.includes(key)&&typeof value==='boolean'));
 const value={id:old?.id||newId(),name,username,email,workerId:f.workerId,roleId:f.roleId,active:f.active!==false,menuOverrides:f.roleId==='ADMIN'?{}:overrides};
 if(old)Object.assign(old,value);else s.appUsers.push(value);log(s,actor,'Simpan user',username);return value.id;
}
export function saveRole(s,f,actor){
 requireMenu(s,actor,'settings-roles');const old=f.id?s.roles.find(r=>r.id===f.id):null,name=String(f.name||'').trim();
 if(f.id&&!old)throw Error('Role tidak ditemukan');if(!name)throw Error('Nama role wajib diisi');
 if(s.roles.some(r=>r.id!==f.id&&r.name.toLowerCase()===name.toLowerCase()))throw Error('Nama role sudah digunakan');
 if(old?.id==='ADMIN'&&f.active===false)throw Error('Role Administrator harus tetap aktif');
 if(f.active===false&&s.appUsers.some(u=>u.roleId===f.id&&u.active))throw Error('Pindahkan atau nonaktifkan user aktif yang menggunakan role ini terlebih dahulu');
 if(!['OPERATOR','PPIC','SPV','MANAGER'].includes(f.approvalRole))throw Error('Peran persetujuan tidak valid');
 const menus=old?.id==='ADMIN'?[...allMenus]:[...new Set((f.menus||[]).filter(key=>allMenus.includes(key)))];
 const value={id:old?.id||newId(),name,active:f.active!==false,menus,approvalRole:f.approvalRole};
 if(old)Object.assign(old,value);else s.roles.push(value);log(s,actor,'Simpan role',name);return value.id;
}
export function saveSystemSettings(s,f,actor){
 requireMenu(s,actor,'settings-system');const companyName=String(f.companyName||'').trim(),warehouseName=String(f.warehouseName||'').trim();
 if(!companyName||!warehouseName)throw Error('Nama perusahaan dan gudang wajib diisi');
 if(!allMenus.includes(f.landingPage)||![10,15,25,50].includes(Number(f.tablePageSize)))throw Error('Halaman awal atau jumlah baris tabel tidak valid');
 s.systemSettings={companyName,warehouseName,landingPage:f.landingPage,tablePageSize:Number(f.tablePageSize)};log(s,actor,'Simpan pengaturan sistem',warehouseName);
}
