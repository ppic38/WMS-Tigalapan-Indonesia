import React,{useCallback,useEffect,useRef,useState} from 'react';
import {LayoutDashboard,ArrowDownToLine,Boxes,Package,ClipboardList,Truck,ClipboardCheck,RotateCcw,ShieldCheck,Database,Activity,RefreshCw,ChevronDown,ChevronRight,Warehouse,ScanLine,Settings} from 'lucide-react';

export const navigation=[
 {id:'overview',label:'Overview',items:[['dashboard','Ringkasan gudang',LayoutDashboard],['inventory','Persediaan',Boxes]]},
 {id:'operasional',label:'Operasional',items:[['receiving','Receiving',ArrowDownToLine],['putaway','Putaway',Package],['allocation','Alokasi cabang',ClipboardList],['picking','Batch picking',ScanLine],['packing','Packing',Package],['shipping','Shipping',Truck]]},
 {id:'kontrol',label:'Kontrol gudang',items:[['location-control','Location control',Warehouse],['opname','Stock opname',ClipboardCheck],['returns','Retur barang',RotateCcw],['approvals','Persetujuan',ShieldCheck]]},
 {id:'pengelolaan',label:'Pengelolaan',items:[['master','Master data',Database],['workforce','Tim & operator',Warehouse],['reports','Laporan',Activity],['sync','Integrasi & sinkronisasi',RefreshCw]]},
 {id:'pengaturan',label:'Pengaturan',settings:true,items:[['settings-users','User Management',Database],['settings-roles','Role Management',ShieldCheck],['settings-system','Pengaturan Sistem',Settings]]}
];
export function readNavigationPreferences(storage){
 try{const v=JSON.parse(storage?.getItem('wms38-navigation')||'{}');return {sidebarCollapsed:v?.sidebarCollapsed===true,groups:Object.fromEntries(navigation.map(g=>[g.id,v?.groups?.[g.id]===true]))}}catch{return {sidebarCollapsed:false,groups:{}}}
}
export function useSidebarState(){
 const [preferences,setPreferences]=useState(()=>readNavigationPreferences(typeof localStorage==='undefined'?null:localStorage)),[compact,setCompact]=useState(()=>typeof matchMedia==='function'&&matchMedia('(max-width:1100px)').matches),[mobileOpen,setMobileOpen]=useState(false);
 const sidebarRef=useRef(null),toggleRef=useRef(null);
 useEffect(()=>{try{localStorage.setItem('wms38-navigation',JSON.stringify(preferences))}catch{}},[preferences]);
 useEffect(()=>{const media=matchMedia('(max-width:1100px)'),update=()=>{setCompact(media.matches);setMobileOpen(false)};media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[]);
 useEffect(()=>{
  if(!compact||!mobileOpen)return;
  const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';sidebarRef.current?.querySelector('button')?.focus();
  const handler=e=>{if(e.key==='Escape'){e.preventDefault();setMobileOpen(false)}if(e.key==='Tab'){
   const els=[...sidebarRef.current.querySelectorAll('a[href],button,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length),first=els[0],last=els.at(-1);
   if(e.shiftKey&&(document.activeElement===first||!sidebarRef.current.contains(document.activeElement))){e.preventDefault();last?.focus()}else if(!e.shiftKey&&(document.activeElement===last||!sidebarRef.current.contains(document.activeElement))){e.preventDefault();first?.focus()}
  }};
  document.addEventListener('keydown',handler);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',handler);if(previous?.isConnected)previous.focus();else toggleRef.current?.focus()};
 },[compact,mobileOpen]);
 const toggleGroup=useCallback(id=>setPreferences(p=>({...p,groups:{...p.groups,[id]:!p.groups[id]}})),[]);
 function toggle(){if(compact)setMobileOpen(v=>!v);else setPreferences(p=>({...p,sidebarCollapsed:!p.sidebarCollapsed}))}
 function hide(){if(compact)setMobileOpen(false);else{setPreferences(p=>({...p,sidebarCollapsed:true}));toggleRef.current?.focus()}}
 return {preferences,compact,mobileOpen,setMobileOpen,sidebarRef,toggleRef,toggleGroup,toggle,hide,visible:compact?mobileOpen:!preferences.sidebarCollapsed};
}
export function NavigationGroups({allowed,active,collapsed={},onToggle,pendingReceiving=0,pendingApprovals=0}){
 return <nav aria-label="Bagian menu gudang">{navigation.map(g=>{const items=g.items.filter(([id])=>allowed.includes(id));if(!items.length)return null;const open=!collapsed[g.id],current=items.some(([id])=>id===active),control=g.settings?'settings-submenu':`navigation-${g.id}`;
  return <section className="nav-group" key={g.id}><button type="button" className={`nav-section-toggle ${current?'contains-active':''}`} aria-expanded={open} aria-controls={control} onClick={()=>onToggle(g.id)}>{g.settings&&<Settings size={17}/>}<span>{g.label}</span>{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button>
  <div id={control} className="nav-section-items" hidden={!open}>{items.map(([id,label,Icon])=><a href={`#${id}`} key={id} aria-current={active===id?'page':undefined} className={`nav-item ${g.settings?'settings-submenu-item ':''}${active===id?'active':''}`}><Icon size={19}/><span>{label}</span>{id==='approvals'&&pendingApprovals>0&&<b>{pendingApprovals}</b>}{id==='receiving'&&pendingReceiving>0&&<b>{pendingReceiving}</b>}</a>)}</div></section>;
 })}</nav>;
}
