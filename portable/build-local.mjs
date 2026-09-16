import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Provide absolute output directory');
const esbuild=process.platform==='win32'?'./node_modules/@esbuild/win32-x64/esbuild.exe':'./node_modules/@esbuild/linux-x64/bin/esbuild';
await fs.mkdir(path.join(output,'app'),{recursive:true});
let source=await fs.readFile('src/app.jsx','utf8');
source=source.replace('<form action="/logout" method="post">','<a className="text-button" href="/backup">Cadangan data</a><form action="/logout" method="post">');
source=source.replace('Hubungkan internet untuk memverifikasi sesi PIN.','Server lokal terputus. Buka MULAI-WMS.bat, lalu coba lagi.');
const app=execFileSync(esbuild,['--bundle','--minify','--format=esm','--define:process.env.NODE_ENV="production"','--sourcefile=src/app.jsx','--loader=jsx'],{cwd:process.cwd(),input:source.replaceAll("from './","from './src/"),maxBuffer:16*1024*1024});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};const assets={};
async function collect(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())await collect(file);else assets['/'+path.relative('web',file)]={type:types[path.extname(file)],body:(await fs.readFile(file)).toString('base64')}}}
await collect('web');assets['/app.js']={type:types['.js'],body:app.toString('base64')};
execFileSync(esbuild,['--bundle','--minify','--format=esm',`--outfile=${path.join(output,'app/worker.mjs')}`],{input:`import {createPinGate} from './server/pin-gate.js';export default createPinGate(${JSON.stringify(assets)});`});
execFileSync(esbuild,['portable/backup.js','--bundle','--minify','--format=esm',`--outfile=${path.join(output,'app/backup.js')}`]);
for(const file of ['server.mjs','MULAI-WMS.bat','GANTI-PIN.bat','DIAGNOSA-WMS.bat'])await fs.copyFile(path.join('portable',file),path.join(output,file));
await fs.copyFile('portable/backup.html',path.join(output,'app/backup.html'));
console.log('Local package built without external application dependencies.');
