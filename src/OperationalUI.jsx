import React,{useEffect,useState} from 'react';

// Fold supporting information on handhelds; retain a single set of controls.
export function OperationalDetails({title,children,className=''}){
 const [open,setOpen]=useState(()=>typeof window==='undefined'||!window.matchMedia('(max-width: 1100px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width: 1100px)'),change=()=>setOpen(!media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[]);
 return <details className={`operational-details ${className}`} open={className.includes('required-choice')||open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}</summary><div>{children}</div></details>;
}
