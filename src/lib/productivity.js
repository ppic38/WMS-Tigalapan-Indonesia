import {newId,now} from './data.js';
export const processes={RECEIVING:'Penerimaan koli',CHECKING:'Pengecekan isi koli',PUTAWAY:'Putaway',PICKING:'Picking',PACKING:'Packing',SHIPPING:'Shipping'};
export function ensureWorkState(s){s.workers??=[];s.teams??=[];s.workSessions??=[];s.workEvents??=[]}
export function activeWork(s,user){return (s.workSessions||[]).find(w=>w.userId===user&&w.status==='RUNNING')}
export function startWork(s,process,reference,user,at=now()){
 ensureWorkState(s);const worker=s.workers.find(w=>w.id===user&&w.active),team=s.teams.find(t=>t.id===worker?.teamId);
 if(!worker||!team)throw Error('Pilih operator aktif dan tim terlebih dahulu');if(!processes[process]||!reference)throw Error('Pilih pekerjaan terlebih dahulu');
 if(process==='CHECKING'){const owner=s.workSessions.find(w=>w.process===process&&w.reference===reference&&w.userId!==user&&w.status!=='CLOSED');if(owner)throw Error('Koli sedang dikerjakan operator lain. Selesaikan sesi pemilik terlebih dahulu');}
 const current=activeWork(s,user);if(current){if(current.process===process&&current.reference===reference)return current.id;throw Error(`Jeda atau selesaikan ${processes[current.process]} yang masih berjalan`)}
 let session=s.workSessions.find(w=>w.userId===user&&w.process===process&&w.reference===reference&&w.status==='PAUSED');
 if(!session){session={id:newId(),userId:user,userName:worker.name,teamId:team.id,teamName:team.name,process,reference,status:'RUNNING',intervals:[],createdAt:at};s.workSessions.push(session)}
 session.status='RUNNING';session.intervals.push({start:at,end:null});return session.id;
}
export function stopWork(s,id,user,finish=false,at=now()){
 const w=s.workSessions?.find(w=>w.id===id&&w.userId===user);if(!w||w.status==='CLOSED')throw Error('Sesi kerja sudah selesai atau tidak ditemukan');
 const interval=w.intervals.at(-1);if(interval&&!interval.end)interval.end=at;w.status=finish?'CLOSED':'PAUSED';if(finish)w.closedAt=at;
}
export function requireWork(s,process,reference,user){const w=activeWork(s,user);if(!w||w.process!==process||w.reference!==reference)throw Error(`Klik Mulai kerja untuk ${processes[process]} ini sebelum scan`);return w}
export function recordWork(s,process,reference,user,{qty,lineKeys,unit='pcs'},at=now()){
 const w=requireWork(s,process,reference,user);if(!Number.isSafeInteger(qty)||qty<0)throw Error('Jumlah produktivitas tidak valid');
 s.workEvents.push({id:newId(),sessionId:w.id,userId:user,userName:w.userName,teamId:w.teamId,teamName:w.teamName,process,reference,qty,unit,lineKeys:[...new Set(lineKeys)],createdAt:at});
}
export function finishWork(s,process,reference,at=now()){for(const w of s.workSessions||[])if(w.process===process&&w.reference===reference&&w.status!=='CLOSED')stopWork(s,w.id,w.userId,true,at)}
export function sessionMilliseconds(session,start=-Infinity,end=Date.now()){
 return session.intervals.reduce((n,i)=>n+Math.max(0,Math.min(new Date(i.end||end).getTime(),end)-Math.max(new Date(i.start).getTime(),start)),0);
}
export function productivity(s,{start=-Infinity,end=Date.now(),teamId='ALL',userId='ALL',process='ALL'}={}){
 const people=new Map(),teams=new Map();
 const include=w=>(teamId==='ALL'||teamId===w.teamId)&&(userId==='ALL'||userId===w.userId)&&(process==='ALL'||process===w.process);
 function get(map,key,w,team){if(!map.has(key))map.set(key,{id:key,name:team?w.teamName:w.userName,userId:team?null:w.userId,teamId:w.teamId,teamName:w.teamName,process:w.process,unit:w.process==='RECEIVING'?'koli':'pcs',milliseconds:0,qty:0,lines:new Set(),workers:new Set()});return map.get(key)}
 for(const w of s.workSessions||[]){if(!include(w))continue;const ms=sessionMilliseconds(w,start,end);if(!ms)continue;for(const row of [get(people,`${w.userId}|${w.teamId}|${w.process}`,w,false),get(teams,`${w.teamId}|${w.process}`,w,true)]){row.milliseconds+=ms;row.workers.add(w.userId)}}
 for(const e of s.workEvents||[]){const when=new Date(e.createdAt).getTime();if(!include(e)||when<start||when>end)continue;for(const row of [get(people,`${e.userId}|${e.teamId}|${e.process}`,e,false),get(teams,`${e.teamId}|${e.process}`,e,true)]){row.qty+=e.qty;for(const key of e.lineKeys)row.lines.add(`${e.reference}|${key}`);row.workers.add(e.userId)}}
 const finalize=map=>[...map.values()].map(r=>({...r,lines:r.lines.size,workers:r.workers.size,hours:r.milliseconds/3600000,linesPerHour:r.milliseconds>=60000?r.lines.size/(r.milliseconds/3600000):null,qtyPerHour:r.milliseconds>=60000?r.qty/(r.milliseconds/3600000):null}));
 return {people:finalize(people),teams:finalize(teams)};
}
export function saveTeam(s,f){ensureWorkState(s);const name=String(f.name||'').trim();if(!name)throw Error('Nama tim wajib diisi');if(s.teams.some(t=>t.id!==f.id&&t.name.toLowerCase()===name.toLowerCase()))throw Error('Nama tim sudah digunakan');if(f.id){const team=s.teams.find(t=>t.id===f.id);if(!team)throw Error('Tim tidak ditemukan');team.name=name;return team.id}const id=newId();s.teams.push({id,name});return id}
export function saveWorker(s,f){ensureWorkState(s);const name=String(f.name||'').trim();if(!name||!s.teams.some(t=>t.id===f.teamId))throw Error('Nama operator dan tim wajib diisi');if(s.workers.some(w=>w.id!==f.id&&w.name.toLowerCase()===name.toLowerCase()))throw Error('Nama operator sudah digunakan');if(f.id){const worker=s.workers.find(w=>w.id===f.id);if(!worker)throw Error('Operator tidak ditemukan');if((f.teamId!==worker.teamId||f.active===false)&&s.workSessions.some(w=>w.userId===f.id&&w.status!=='CLOSED'))throw Error('Selesaikan sesi kerja operator sebelum mengganti tim atau menonaktifkan');if(f.active===false&&s.pickBatches?.some(b=>b.assigneeId===f.id&&!['FINISHED','CANCELLED'].includes(b.status)))throw Error('Operator masih ditugaskan pada batch aktif');Object.assign(worker,{name,teamId:f.teamId,active:f.active!==false});return worker.id}const id=newId();s.workers.push({id,name,teamId:f.teamId,active:true});return id}
