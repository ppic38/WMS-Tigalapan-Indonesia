import React,{useEffect,useId,useRef,useState} from 'react';
import {RotateCcw,RotateCw,ZoomIn,ZoomOut,Maximize2} from 'lucide-react';
import {Button,Empty,Field,Select,num} from '../ui.jsx';
import {isStorageLocation,locationCapacity,locationAssignments} from '../lib/locations.js';
import {currentWarehouseLayout,storageRacks,rackPoint} from '../lib/warehouse-layout.js';

const palette={A:'#2d6fa6',B:'#d49a36',C:'#8963b4',none:'#687b8a',mixed:'#506c82'};
const materials={steel:['#405665','#6f8795','#253945'],beam:['#c97631','#eba565','#975223'],deck:['#9aa8ad','#d0d8d9','#6e7d84'],foot:['#64757f','#a2b0b6','#3c4b55'],bale:['#34475c','#6d7d8c','#233343']};

export function rackScene(s,{query='',abc='',zone='',mode='mapping'}={}){
 return s.locations.filter(isStorageLocation).sort((a,b)=>a.locationCode.localeCompare(b.locationCode)).flatMap(l=>{
  const entries=mode==='stock'?s.stock.filter(r=>r.locationCode===l.locationCode&&r.qty>0).map(r=>({item:s.items.find(i=>i.sku===r.sku)||{sku:r.sku},qty:r.qty})):locationAssignments(s,l.locationCode);
  const classes=[...new Set(entries.map(r=>r.item.abcClass||'none'))].sort();
  if(zone&&l.zone!==zone||abc&&!classes.includes(abc))return [];
  if(query&&!`${l.locationCode} ${entries.map(r=>`${r.item.sku} ${r.item.itemName||''}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()))return [];
  return [{...l,...locationCapacity(s,l.locationCode),entries,classes,rackId:l.locationCode.slice(0,3)}];
 });
}
export function rackGeometry(s,rows){
 const layout=currentWarehouseLayout(s),catalog=storageRacks(s);
 return layout.racks.filter(r=>rows.some(l=>l.rackId===r.id)).map(r=>({...r,...catalog.find(c=>c.id===r.id),cells:rows.filter(l=>l.rackId===r.id)}));
}

// Share one Higgsfield texture across the projected package faces. Geometry,
// interactive targets and ABC labels are derived independently from WMS data.
function MaterialFace({face,texture,opacity=0.85}){
 const [bottomLeft,,topRight,topLeft]=face;
 const matrix=[topRight[0]-topLeft[0],topRight[1]-topLeft[1],bottomLeft[0]-topLeft[0],bottomLeft[1]-topLeft[1],...topLeft];
 return <use href={`#${texture}`} width="1" height="1" transform={`matrix(${matrix.join(' ')})`} opacity={opacity} pointerEvents="none"/>;
}

export default function Rack3D({s,query='',abc='',zone='',mode='mapping',onSelect,onExpand,expanded=false}){
 const scrollRef=useRef(null),[viewport,setViewport]=useState({width:1000,height:700});
 const uid=useId().replace(/[^a-zA-Z0-9_-]/g,''),prefix=`rack-${uid}`,texture=`${prefix}-textile`;
 const [angle,setAngle]=useState(-15),[zoom,setZoom]=useState(1),[tilt,setTilt]=useState(0.7),[focus,setFocus]=useState('');
 const filtered=rackScene(s,{query,abc,zone,mode}),allRacks=[...new Set(filtered.map(l=>l.rackId))],activeFocus=allRacks.includes(focus)?focus:'',rows=activeFocus?filtered.filter(l=>l.rackId===activeFocus):filtered;
 const layout=currentWarehouseLayout(s),parts=rackGeometry(s,rows);
 useEffect(()=>{const el=scrollRef.current;if(!el)return;const measure=()=>{const next={width:Math.max(680,Math.round(el.clientWidth)),height:Math.max(300,Math.round(el.clientHeight))};setViewport(old=>old.width===next.width&&old.height===next.height?old:next)};measure();if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect()}window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure)},[expanded,rows.length]);
 if(!rows.length)return <Empty title="Tidak ada lokasi sesuai filter" description="Ubah pencarian, zona, atau kelas ABC."/>;
 const rad=angle*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad);
 const raw=([x,y,z])=>{const X=x*cs-y*sn,Y=x*sn+y*cs;return [(X-Y)*0.8,(X+Y)*tilt-z]};
 const floor=[[0,0,0],[layout.warehouse.width,0,0],[layout.warehouse.width,layout.warehouse.depth,0],[0,layout.warehouse.depth,0]];
 const corners=parts.flatMap(r=>[0,r.width].flatMap(x=>[0,r.depth].flatMap(y=>[0,r.height].map(z=>rackPoint(r,[x,y,z])))).concat([rackPoint(r,[r.width/2,0,r.height+0.7])]));
 const bounds=[...corners,...(activeFocus?[]:floor)].map(raw),minX=Math.min(...bounds.map(p=>p[0])),maxX=Math.max(...bounds.map(p=>p[0])),minY=Math.min(...bounds.map(p=>p[1])),maxY=Math.max(...bounds.map(p=>p[1]));
 const scale=Math.min((viewport.width-100)/Math.max(0.1,maxX-minX),(viewport.height-100)/Math.max(0.1,maxY-minY));
 const project=p=>{const [x,y]=raw(p);return [(x-(minX+maxX)/2)*scale+viewport.width/2,(y-(minY+maxY)/2)*scale+viewport.height/2]};
 const points=ps=>ps.map(project).map(p=>p.join(',')).join(' '),depth=([x,y,z])=>x*(cs+sn)+y*(cs-sn)+z*2*tilt;
 const geometry=parts.map(r=>({...r,center:rackPoint(r,[r.width/2,r.depth/2,r.height/2])})).sort((a,b)=>depth(a.center)-depth(b.center));

 function renderRack(r){
  const localAngle=(angle+r.rotation)*Math.PI/180,c=Math.cos(localAngle),n=Math.sin(localAngle),frontNear=c-n>=0,sideNear=c+n>=0;
  const side=sideNear?[1,2,6,5]:[0,3,7,4],front=frontNear?[3,2,6,7]:[0,1,5,4];
  const binWidth=r.width/r.bins.length,levelHeight=r.height/r.levels.length,post=Math.min(0.065,binWidth*0.09,r.depth*0.09),beamHeight=Math.min(0.10,levelHeight*0.13),deckHeight=Math.min(0.035,levelHeight*0.04);
  const nearY=frontNear?r.depth:0,nearX=sideNear?r.width:0;
  const local=p=>rackPoint(r,p),projectLocal=p=>project(local(p)),localPoints=ps=>points(ps.map(local));
  const objects=[],labels=[];
  function cuboid(key,x,y,z,w,d,h,material){
   const v=[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]].map(local),color=materials[material];
   return {key,depth:depth(local([x+w/2,y+d/2,z+h/2])),node:<g key={key} className={`rack3d-${material}`}>
    <polygon points={points(side.map(i=>v[i]))} fill={color[2]}/><polygon points={points(front.map(i=>v[i]))} fill={color[0]}/><polygon points={points([4,5,6,7].map(i=>v[i]))} fill={color[1]}/>
    {material==='bale'&&<><MaterialFace face={front.map(i=>project(v[i]))} texture={texture}/><MaterialFace face={side.map(i=>project(v[i]))} texture={texture} opacity={0.60}/><MaterialFace face={[4,5,6,7].map(i=>project(v[i]))} texture={texture} opacity={0.78}/>
     <polygon points={points([4,5,6,7].map(i=>v[i]))} fill={`url(#${prefix}-film)`}/><polyline points={points([4,5,6,7,4].map(i=>v[i]))} fill="none" stroke="#f2f6f8" strokeOpacity="0.4" strokeWidth="0.65"/>
     {[0.25,0.74].map((position,i)=><polygon key={i} points={localPoints([[x+w*position,y,z+h+0.001],[x+w*(position+0.035),y,z+h+0.001],[x+w*(position+0.035),y+d,z+h+0.001],[x+w*position,y+d,z+h+0.001]])} fill="#eef5f9" fillOpacity="0.25"/>)}</>}
   </g>};
  }
  function line(key,a,b,color,width){
   const A=projectLocal(a),B=projectLocal(b);
   objects.push({key,depth:(depth(local(a))+depth(local(b)))/2,node:<line key={key} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={color} strokeWidth={width} strokeLinecap="round" pointerEvents="none"/>});
  }
  [0,r.width-post].forEach((x,i)=>[0,r.depth-post].forEach((y,j)=>{
   objects.push(cuboid(`foot-${i}-${j}`,x-post*0.4,y-post*0.4,0,post*1.8,post*1.8,deckHeight,'foot'));
   r.levels.forEach((_,level)=>objects.push(cuboid(`leg-${i}-${j}-${level}`,x,y,level*levelHeight,post,post,levelHeight,'steel')));
  }));
  [0,r.width].forEach((x,edge)=>r.levels.forEach((_,i)=>{
   const z=i*levelHeight;
   line(`brace-a-${edge}-${i}`,[x,post,z+beamHeight],[x,r.depth-post,z+levelHeight-beamHeight],'#6f838f',Math.max(1.1,post*scale*0.36));
   line(`brace-b-${edge}-${i}`,[x,r.depth-post,z+beamHeight],[x,post,z+levelHeight-beamHeight],'#758894',Math.max(1.1,post*scale*0.36));
  }));
  r.levels.forEach((_,level)=>r.bins.forEach((_,bin)=>{
   const z=level*levelHeight+beamHeight,x=bin*binWidth;
   objects.push(cuboid(`deck-${level}-${bin}`,x,post,z,binWidth,r.depth-post*2,deckHeight,'deck'));
   [0,r.depth-post].forEach((y,edge)=>objects.push(cuboid(`beam-${level}-${bin}-${edge}`,x,y,z-beamHeight,binWidth,post,beamHeight,'beam')));
   [0,r.depth-post].forEach((y,edge)=>line(`beam-edge-${level}-${bin}-${edge}`,[x,y,z],[x+binWidth,y,z],'#f3c596',0.7));
  }));
  for(const cell of r.cells){
   const bin=r.bins.indexOf(cell.locationCode.slice(-2)),level=r.levels.indexOf(cell.locationCode[4]),x=bin*binWidth,z=level*levelHeight+beamHeight+deckHeight;
   const color=palette[cell.classes.length>1?'mixed':cell.classes[0]||'none'],full=cell.blocked||cell.free===0;
   const occupied=cell.entries.length>0,frontWidth=Math.abs(c-n)*binWidth*0.8*scale,sideWidth=Math.abs(c+n)*r.depth*0.8*scale;
   const labelPoint=frontWidth>=sideWidth?[x+binWidth/2,nearY,z+levelHeight*0.24]:[sideNear?x+binWidth:x,r.depth/2,z+levelHeight*0.24];
   const label=projectLocal(labelPoint),faceWidth=Math.max(frontWidth,sideWidth),abcLabel=cell.classes.map(v=>v==='none'?'?':v).join('/')||'—';
   const fontSize=Math.max(6,Math.min(13,faceWidth/(abcLabel.length+1.7)*0.7,levelHeight*scale*0.28)),badgeHeight=fontSize+8,badgeWidth=Math.max(14,abcLabel.length*fontSize*0.67+10),showCode=faceWidth>75;
   const slot=[[x+post,post,z],[x+binWidth-post,post,z],[x+binWidth-post,r.depth-post,z],[x+post,r.depth-post,z]];
   const baleW=(binWidth-post*3)/2,baleD=r.depth*0.72,baleH=levelHeight*0.255,bales=[];
   if(occupied)for(let stack=0;stack<2;stack++)for(let column=0;column<2;column++){
    const jitter=stack?binWidth*0.013:0;
    bales.push(cuboid(`bale-${cell.code}-${stack}-${column}`,x+post*1.25+column*(baleW+post*0.5)+jitter,r.depth*0.13,z+0.012+stack*(baleH+0.009),baleW,baleD,baleH,'bale'));
   }
   bales.sort((a,b)=>a.depth-b.depth);
   objects.push({key:`slot-${cell.code}`,depth:depth(local([x+binWidth/2,r.depth/2,z])),node:<polygon key={`slot-${cell.code}`} points={localPoints(slot)} fill={color} fillOpacity={occupied?0.2:0.08} stroke={full?'#ad3431':color} strokeWidth={full?2:0.8} pointerEvents="none"/>},...bales);
   const face=frontWidth>=sideWidth?[[x+post,nearY,z],[x+binWidth-post,nearY,z],[x+binWidth-post,nearY,z+levelHeight*0.62],[x+post,nearY,z+levelHeight*0.62]]:[[sideNear?x+binWidth:x,post,z],[sideNear?x+binWidth:x,r.depth-post,z],[sideNear?x+binWidth:x,r.depth-post,z+levelHeight*0.62],[sideNear?x+binWidth:x,post,z+levelHeight*0.62]];
   labels.push({key:cell.code,depth:depth(local([x+binWidth/2,r.depth/2,z+baleH])),node:<g key={cell.code} className="rack3d-bin" role="button" tabIndex={0} onClick={()=>onSelect?.(cell.code)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(cell.code)}}} aria-label={`Lokasi ${cell.code}, ABC ${cell.classes.join('/')||'belum diisi'}, ${cell.entries.length} SKU, ${num(cell.used)} pcs, ${cell.status}`}>
    <title>{`${cell.code} · ${cell.entries.map(entry=>entry.item.sku).join(', ')||'Belum ada SKU'} · ${num(cell.used)} pcs · ${cell.status}`}</title>
    <polygon className="rack3d-slot-outline" points={localPoints(face)} fill="#ffffff" fillOpacity="0" stroke="#102d46" strokeOpacity="0"/>
    <g className="rack3d-bin-tag" transform={`translate(${label.join(' ')})`}><rect className="rack3d-tag-background" x={-badgeWidth/2} y={-badgeHeight/2} width={badgeWidth} height={badgeHeight} rx="2" fill={color} stroke={full?'#ffcac5':'#edf3f7'} strokeWidth={full?2:0.8}/><text y={fontSize*0.35} textAnchor="middle" fill={cell.classes.length===1&&cell.classes[0]==='B'?'#263541':'white'} fontSize={fontSize} fontWeight="700">{abcLabel}</text>
     {showCode&&<g transform="translate(0 18)"><rect x="-30" y="-5" width="60" height="16" rx="2" fill="#f6f8f9" fillOpacity="0.96"/><text y="6" textAnchor="middle" fill="#324652" fontSize="9">{cell.code}</text></g>}
    </g>
   </g>});
  }
  r.levels.forEach((_,i)=>[0.22,0.48,0.75].forEach((fraction,j)=>{
   const p=[nearX,nearY,i*levelHeight+levelHeight*fraction],pos=projectLocal(p);
   objects.push({key:`bolt-${i}-${j}`,depth:depth(local(p))+post,node:<circle key={`bolt-${i}-${j}`} cx={pos[0]} cy={pos[1]} r={Math.min(1.1,Math.max(0.55,post*scale*0.16))} fill="#c0cdd3" pointerEvents="none"/>});
  }));
  objects.sort((a,b)=>a.depth-b.depth);labels.sort((a,b)=>a.depth-b.depth);
  const top=[0,r.width].flatMap(x=>[0,r.depth].map(y=>projectLocal([x,y,r.height]))),title=[(Math.min(...top.map(p=>p[0]))+Math.max(...top.map(p=>p[0])))/2,Math.min(...top.map(p=>p[1]))-16];
  return <g key={r.id} data-rack={r.id} data-x={r.x} data-y={r.y} data-rotation={r.rotation}>
   <g pointerEvents="none">{objects.map(o=>o.node)}</g>{labels.map(o=>o.node)}
   <g transform={`translate(${title.join(' ')})`} pointerEvents="none"><rect x={activeFocus?-41:-32} y="-14" width={activeFocus?82:64} height="22" rx="4" fill="#f9fbfc" fillOpacity="0.96" stroke="#b5c3cd"/><text textAnchor="middle" fontSize={activeFocus?14:11} fontWeight="700" fill="#294556">Rak {r.id}</text></g>
  </g>;
 }

 const gridStep=Math.max(1,Math.ceil(Math.max(layout.warehouse.width,layout.warehouse.depth)/30));
 return <div className={`rack3d ${expanded?'rack3d-expanded':''}`}><div className="rack3d-focus"><Field label="Fokus rak"><Select value={activeFocus} onChange={e=>{setFocus(e.target.value);setZoom(1)}}><option value="">Semua rak</option>{allRacks.map(r=><option key={r} value={r}>Rak {r}</option>)}</Select></Field><span>{layout.configured?(layout.unplaced.length?`${layout.unplaced.length} rak baru perlu diatur posisinya.`:'Posisi dan ukuran mengikuti tata letak tersimpan.'):'Layout otomatis · sesuaikan melalui Atur tata letak.'}</span></div>
 <div className="rack3d-tools" role="group" aria-label="Sudut pandang rak 3D"><Button icon={RotateCcw} variant="secondary" aria-label="Putar rak ke kiri" onClick={()=>setAngle(a=>a-15)}>Kiri</Button><Button icon={RotateCw} variant="secondary" aria-label="Putar rak ke kanan" onClick={()=>setAngle(a=>a+15)}>Kanan</Button><Button icon={ZoomOut} variant="secondary" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-0.25))}>Perkecil</Button><Button icon={ZoomIn} variant="secondary" disabled={zoom>=2.5} onClick={()=>setZoom(z=>Math.min(2.5,z+0.25))}>Perbesar</Button><Button variant="secondary" onClick={()=>setTilt(v=>v===0.7?1:0.7)}>{tilt===0.7?'Lihat dari atas':'Lihat dari depan'}</Button><Button variant="ghost" onClick={()=>{setAngle(-15);setZoom(1);setTilt(0.7)}}>Reset tampilan</Button>{onExpand&&<Button variant="secondary" icon={Maximize2} onClick={onExpand}>Layar penuh</Button>}</div>
 <div ref={scrollRef} className="rack3d-scroll" tabIndex={0} aria-label="Area rak 3D, geser untuk melihat semua lokasi"><svg fontFamily="Arial, sans-serif" className="rack3d-svg" style={{width:`${zoom*100}%`,height:`${zoom*100}%`,minWidth:680*zoom}} viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label="Layout rak 3D berdasarkan kelas ABC">
 <defs><symbol id={texture} viewBox="0.045 0.04 0.91 0.92" preserveAspectRatio="none"><image href="/assets/rack-textile-higgsfield.webp" width="1" height="1" preserveAspectRatio="none"/></symbol>
  <linearGradient id={`${prefix}-background`} x2="0" y2="1"><stop stopColor="#eef2f4"/><stop offset="1" stopColor="#dce4e9"/></linearGradient>
  <linearGradient id={`${prefix}-floor`} x2="0.2" y2="1"><stop stopColor="#e6e9e9"/><stop offset="1" stopColor="#c2cdd2"/></linearGradient>
  <linearGradient id={`${prefix}-film`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e9f3fa" stopOpacity="0.05"/><stop offset="0.37" stopColor="#eef7fb" stopOpacity="0.4"/><stop offset="0.42" stopColor="#e6f0f7" stopOpacity="0.07"/><stop offset="0.8" stopColor="#9aabb8" stopOpacity="0.2"/><stop offset="1" stopColor="#f2f9ff" stopOpacity="0.5"/></linearGradient>
  <filter id={`${prefix}-shadow`} x="-20%" y="-40%" width="150%" height="190%"><feGaussianBlur stdDeviation="3.5"/></filter>
 </defs><rect width={viewport.width} height={viewport.height} rx="12" fill={`url(#${prefix}-background)`}/>
 {!activeFocus&&<g pointerEvents="none"><polygon points={points(floor.map(([x,y,z])=>[x,y,z-0.12]))} fill="#a7b6c0"/><polygon points={points(floor)} fill={`url(#${prefix}-floor)`} stroke="#b0bec6"/>
 {Array.from({length:Math.ceil(layout.warehouse.width/gridStep)},(_,i)=>(i+1)*gridStep).filter(x=>x<layout.warehouse.width).map(x=><polyline key={`x${x}`} points={points([[x,0,0],[x,layout.warehouse.depth,0]])} fill="none" stroke="#b0bdc5" strokeOpacity="0.32" strokeWidth="0.65"/>)}
 {Array.from({length:Math.ceil(layout.warehouse.depth/gridStep)},(_,i)=>(i+1)*gridStep).filter(y=>y<layout.warehouse.depth).map(y=><polyline key={`y${y}`} points={points([[0,y,0],[layout.warehouse.width,y,0]])} fill="none" stroke="#b0bdc5" strokeOpacity="0.32" strokeWidth="0.65"/>)}
 </g>}
 <g pointerEvents="none">{parts.map(r=><g key={r.id}><polygon points={points([[0,0,0],[r.width+0.4,0.16,0],[r.width+0.4,r.depth+0.32,0],[0.18,r.depth+0.3,0]].map(p=>rackPoint(r,p)))} fill="#253c4a" fillOpacity="0.2" filter={`url(#${prefix}-shadow)`}/><polygon points={points([[0,0,0],[r.width,0,0],[r.width,r.depth,0],[0,r.depth,0]].map(p=>rackPoint(r,p)))} fill="#324a59" fillOpacity="0.13"/></g>)}</g>
 {geometry.map(renderRack)}
 </svg></div><div className="rack3d-caption"><span>{parts.length} rak · {rows.length} lokasi · {mode==='stock'?'stok fisik':'mapping utama & reserve'}</span><span>Ketuk lokasi untuk melihat SKU dan qty. Isi bal merupakan ilustrasi.</span></div></div>;
}
