import {execFileSync} from 'node:child_process';
const esbuild='./node_modules/@esbuild/linux-x64/bin/esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const app=execFileSync(esbuild,['src/app.jsx','--bundle','--minify','--format=esm','--define:process.env.NODE_ENV="production"'],{maxBuffer:16*1024*1024});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const assets={};
async function collect(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await collect(file);else assets['/'+path.relative('web',file)]={type:types[path.extname(file)]||'application/octet-stream',body:(await fs.readFile(file)).toString('base64')}}}
await collect('web');assets['/app.js']={type:types['.js'],body:Buffer.from(app).toString('base64')};
await fs.rm('dist',{recursive:true,force:true});await fs.mkdir('dist/.openai',{recursive:true});
execFileSync(esbuild,['--bundle','--minify','--format=esm','--platform=browser','--outfile=dist/server/index.js'],{input:`import {createPinGate} from './server/pin-gate.js';export default createPinGate(${JSON.stringify(assets)});`,stdio:['pipe','inherit','inherit']});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log(`Built PIN-protected Worker with ${Object.keys(assets).length} embedded assets.`);
