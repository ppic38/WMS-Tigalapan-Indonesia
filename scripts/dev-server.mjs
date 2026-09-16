import http from 'node:http';
import fs from 'node:fs';
import worker from '../dist/server/index.js';
const args=process.argv.slice(2);const arg=(key,fallback)=>{const i=args.indexOf(key);return i>=0?args[i+1]:fallback};
http.createServer(async(req,res)=>{try{
  const host=(req.headers.host||'').split(':')[0];if(!['terminal.local','localhost','127.0.0.1'].includes(host)){res.writeHead(403);return res.end('Host not allowed')}
  // Synthetic component QA is available only in this internal dev server.
  // Production Worker authentication and user data are never involved.
  const qa={'/qa':['tests/qa-assets/index.html','text/html'],'/qa/frame.html':['tests/qa-assets/frame.html','text/html'],'/qa/qa.js':['tests/qa-assets/qa.js','text/javascript'],'/qa/style.css':['web/style.css','text/css']}[new URL(req.url,'http://terminal.local').pathname];
  if(qa){if(!fs.existsSync(qa[0])){res.writeHead(503);return res.end('Build tests/ui-qa.jsx into tests/qa-assets/qa.js before component QA.')}res.setHeader('Content-Type',qa[1]);return res.end(fs.readFileSync(qa[0]))}
  const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
  const response=await worker.fetch(request,process.env);
  if(req.url==='/'&&response.headers.get('content-type')?.includes('text/html')){
    const html=(await response.text()).replace('</body>','<a href="/qa" style="position:fixed;bottom:8px;left:8px;background:white;padding:8px;z-index:9999">Uji komponen dengan data sintetis</a></body>');
    res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(html);
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch{res.writeHead(500);res.end('Preview error')}}).listen(Number(arg('--port','4173')),arg('--host','0.0.0.0'),()=>console.log('WMS preview ready; configure WMS_TEST_PIN_HASH and WMS_SESSION_SECRET.'));
