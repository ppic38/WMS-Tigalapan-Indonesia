import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import worker from './app/worker.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const host='127.0.0.1',port=8765,origin=`http://localhost:${port}`;
const settingsFile=path.join(root,'data','server-config.json');
await fs.mkdir(path.dirname(settingsFile),{recursive:true});
let env;
try{env=JSON.parse(await fs.readFile(settingsFile,'utf8'));if(!/^[a-f0-9]{64}$/.test(env.WMS_TEST_PIN_HASH)||!env.WMS_SESSION_SECRET||env.WMS_SESSION_SECRET.length<32)throw new Error('Invalid configuration')}
catch(error){if(error.code!=='ENOENT')throw new Error('Konfigurasi server rusak. Pulihkan data/server-config.json dari salinan Anda.');env={WMS_TEST_PIN_HASH:createHash('sha256').update('60623560').digest('hex'),WMS_SESSION_SECRET:randomBytes(32).toString('hex')};await fs.writeFile(settingsFile,JSON.stringify(env,null,2),{mode:0o600,flag:'wx'})}
try{const config=JSON.parse(await fs.readFile(path.join(root,'data','integration-config.json'),'utf8'));for(const key of ['WMS_INTEGRATION_ENABLED','SUPABASE_URL','SUPABASE_SERVER_KEY','MINI_ERP_RESI_RPC','WMS_OUTBOX_RPC','MOKA_ACCESS_TOKEN','MOKA_OUTLET_MAP','WMS_ALLOW_EVENT_SUBMIT'])if(typeof config[key]==='string')env[key]=config[key]}catch(e){if(e.code!=='ENOENT')throw new Error('Konfigurasi integrasi tidak valid. Periksa data/integration-config.json.')}
if(process.argv.includes('--change-pin')){
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const pin=await rl.question('PIN baru (8 digit): '),repeat=await rl.question('Ulangi PIN baru: ');rl.close();
 if(!/^\d{8}$/.test(pin)||pin!==repeat){console.error('PIN harus 8 digit dan kedua isian harus sama. Tidak ada perubahan.');process.exitCode=1}
 else{env.WMS_TEST_PIN_HASH=createHash('sha256').update(pin).digest('hex');env.WMS_SESSION_SECRET=randomBytes(32).toString('hex');await fs.writeFile(settingsFile,JSON.stringify(env,null,2),{mode:0o600});console.log('PIN disimpan. Tutup server WMS yang berjalan, lalu buka MULAI-WMS.bat kembali.');}
}else{
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!==`localhost:${port}`){res.writeHead(403);res.end('Buka http://localhost:8765');return}
   const pathname=new URL(req.url,origin).pathname;
   if(pathname==='/local/health'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('WMS38-LOCAL-1');return}
   const request=new Request(new URL(req.url,origin),{method:req.method,headers:{...req.headers,'cf-connecting-ip':req.socket.remoteAddress},...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
   let response;
   if(pathname==='/backup'||pathname==='/backup.js'){
    const auth=await worker.fetch(new Request(origin+'/auth/session',{headers:request.headers}),env);
    if(auth.status!==200)response=new Response(null,{status:303,headers:{Location:'/login','Cache-Control':'no-store'}});
    else if(!['GET','HEAD'].includes(req.method))response=new Response('Metode tidak didukung',{status:405});
    else response=new Response(req.method==='HEAD'?null:await fs.readFile(path.join(root,'app',pathname==='/backup'?'backup.html':'backup.js')),{headers:{'Content-Type':pathname==='/backup'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
   }else response=await worker.fetch(request,env);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{if(!res.headersSent)res.writeHead(500,{'Cache-Control':'no-store'});res.end('Proses belum berhasil. Muat ulang halaman.');}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 function openBrowser(){if(process.argv.includes('--no-open'))return;const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',origin]:[origin];const child=spawn(command,args,{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref()}
 server.on('error',async error=>{
  if(error.code==='EADDRINUSE'){try{const r=await fetch(origin+'/local/health',{signal:AbortSignal.timeout(2000)});if(await r.text()==='WMS38-LOCAL-1'){console.log('WMS sudah berjalan. Membuka browser.');openBrowser();return}}catch{}console.error('Port 8765 dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi. Jangan mengubah port agar data browser tetap sama.')}
  else console.error('Server tidak dapat dimulai: '+error.code);
  process.exitCode=1;
 });
 server.listen(port,host,()=>{console.log('\nWMS 38 LOKAL\nBuka: '+origin+'\nPIN awal: 60623560 (jika belum diubah)\nBiarkan jendela ini terbuka saat memakai WMS.\nTutup jendela atau tekan Ctrl+C untuk menghentikan.\nCadangkan data melalui tombol Cadangan data di aplikasi.\n');openBrowser()});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
