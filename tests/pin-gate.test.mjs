import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPinGate,isSameOriginPost} from '../server/pin-gate.js';
import production from '../dist/server/index.js';
import fs from 'node:fs/promises';
const pin='12345678'; // Synthetic fixture, never the deployment PIN.
const env={WMS_TEST_PIN_HASH:createHash('sha256').update(pin).digest('hex'),WMS_SESSION_SECRET:'synthetic-session-secret-for-unit-tests-only'};
const origin='https://wms.test';
const asset=text=>({type:'text/html',body:Buffer.from(text).toString('base64')});
const assets={'/index.html':asset('PROTECTED APP'),'/app.js':asset('PROTECTED SCRIPT'),'/sw.js':asset('cleanup worker')};
function req(path,options={}){return new Request(origin+path,options)}
function post(path,value=pin,extra={}){return req(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams({pin:value})})}
async function login(worker){const r=await worker.fetch(post('/login'),env);assert.equal(r.status,303);assert.equal(r.headers.get('Location'),'/');const c=r.headers.get('Set-Cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=28800','Path=/'])assert(c.includes(flag));return c.split(';')[0]}
test('Gate blocks direct application and assets, fails closed without secrets, and serves a secret-free login page',async()=>{
 const worker=createPinGate(assets);
 for(const path of ['/','/index.html','/app.js','/style.css','/js/workers/allocation.worker.js','/auth/session']){const r=await worker.fetch(req(path),env);assert([303,401].includes(r.status));assert(!(await r.text()).includes('PROTECTED'));assert.match(r.headers.get('Cache-Control'),/no-store/)}
 assert.equal((await worker.fetch(req('/'),{})).status,503);
 const r=await worker.fetch(req('/login'),env);assert.equal(r.status,200);const html=await r.text();assert(html.includes('PIN testing'));for(const secret of [pin,env.WMS_TEST_PIN_HASH,env.WMS_SESSION_SECRET])assert(!html.includes(secret));
 assert.equal((await worker.fetch(post('/login','00000000'),env)).status,401);
});
test('Valid PIN grants signed 8-hour session; altered, expired and secret-rotated cookies are rejected',async()=>{
 let now=Date.now();const worker=createPinGate(assets,{clock:()=>now}),cookie=await login(worker);
 const authorized=()=>req('/',{headers:{Cookie:cookie}});
 assert.equal(await (await worker.fetch(authorized(),env)).text(),'PROTECTED APP');
 assert.equal((await worker.fetch(req('/auth/session',{headers:{Cookie:cookie}}),env)).status,200);
 const forged=cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0');
 assert.equal((await worker.fetch(req('/',{headers:{Cookie:forged}}),env)).status,303);
 assert.equal((await worker.fetch(authorized(),{...env,WMS_SESSION_SECRET:'another-cryptographically-strong-secret-placeholder'})).status,303);
 now+=8*60*60*1000+1;assert.equal((await worker.fetch(authorized(),env)).status,303);
});
test('Login/logout reject cross-origin posts; logout clears cookie; oversized bodies rejected',async()=>{
 const worker=createPinGate(assets);
 for(const path of ['/login','/logout'])assert.equal((await worker.fetch(post(path,pin,{Origin:'https://other.test'}),env)).status,403);
 const r=await worker.fetch(post('/logout'),env);assert.equal(r.status,303);assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal((await worker.fetch(post('/login','x'.repeat(1500)),env)).status,413);
});
test('Repeated invalid PIN is temporarily throttled without blocking another IP',async()=>{
 let now=Date.now();const worker=createPinGate(assets,{clock:()=>now});
 for(let i=0;i<5;i++)assert.equal((await worker.fetch(post('/login','00000000',{'CF-Connecting-IP':'1.1.1.1'}),env)).status,401);
 const blocked=await worker.fetch(post('/login',pin,{'CF-Connecting-IP':'1.1.1.1'}),env);assert.equal(blocked.status,429);assert(blocked.headers.get('Retry-After'));
 assert.equal((await worker.fetch(post('/login',pin,{'CF-Connecting-IP':'2.2.2.2'}),env)).status,303);
 now+=600001;assert.equal((await worker.fetch(post('/login',pin,{'CF-Connecting-IP':'1.1.1.1'}),env)).status,303);
});
test('Observed Chrome form POST with opaque Origin and same-origin metadata can log in and log out',async()=>{
 for(const worker of [createPinGate(assets),production]){
  const headers={Origin:'null','Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
  const r=await worker.fetch(post('/login',pin,headers),env);assert.equal(r.status,303);assert(r.headers.get('Set-Cookie'));
  const cookie=r.headers.get('Set-Cookie').split(';')[0];assert.equal((await worker.fetch(req('/auth/session',{headers:{Cookie:cookie}}),env)).status,200);
  assert.equal((await worker.fetch(post('/logout',pin,headers),env)).status,303);
  assert.equal((await worker.fetch(req('/login'),env)).headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
 }
});
test('Opaque origin recovery cannot allow cross-site, same-site siblings, missing metadata or conflicting origins',()=>{
 for(const origin of ['null','https://other.test','https://sibling.wms.test',undefined])for(const site of ['cross-site','same-site','none',undefined]){
  const headers={};if(origin!==undefined)headers.Origin=origin;if(site!==undefined)headers['Sec-Fetch-Site']=site;
  assert.equal(isSameOriginPost(req('/login',{method:'POST',headers})),false,JSON.stringify(headers));
 }
 assert.equal(isSameOriginPost(post('/login',pin,{Origin:'https://other.test','Sec-Fetch-Site':'same-origin'})),false);
 assert.equal(isSameOriginPost(post('/login',pin,{'Sec-Fetch-Site':'cross-site'})),false);
 assert.equal(isSameOriginPost(req('/login',{method:'POST',headers:{'Sec-Fetch-Site':'same-origin'}})),true);
});
test('Production Worker serves every embedded asset only after PIN and has no static bypass files',async()=>{
 const cookie=await login(production);
 const paths=['/','/index.html','/app.js','/style.css','/manifest.json','/icon.svg','/icon-192.png','/icon-512.png','/js/workers/allocation.worker.js','/js/lib/allocation.js'];
 for(const path of paths){const r=await production.fetch(req(path,{headers:{Cookie:cookie}}),env);assert.equal(r.status,200,path);assert((await r.arrayBuffer()).byteLength>0);assert.match(r.headers.get('Cache-Control'),/no-store/);assert([303,401].includes((await production.fetch(req(path),env)).status))}
 assert.equal((await production.fetch(req('/missing',{headers:{Cookie:cookie}}),env)).status,404);
 assert.deepEqual((await fs.readdir(new URL('../dist/',import.meta.url))).sort(),['.openai','server']);
 const sw=await production.fetch(req('/sw.js'),{});assert.equal(sw.status,200);const code=await sw.text();assert(code.includes('caches.delete'));assert(!code.includes('indexedDB.deleteDatabase'));assert(!code.includes('caches.match'));
});
