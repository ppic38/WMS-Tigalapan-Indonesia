import {migrateState,seed} from '../src/lib/data.js';
import {TEST_DATASET_ID} from '../src/lib/testing-data.js';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export async function makeBackup(state,preferences={}){const payload={state,preferences};return {format:'WMS38-LOCAL-BACKUP',version:1,createdAt:new Date().toISOString(),checksum:await hash(payload),payload}}
export async function validateBackup(input){
 if(input?.format!=='WMS38-LOCAL-BACKUP'||input.version!==1||!input.payload||await hash(input.payload)!==input.checksum)throw Error('File bukan cadangan WMS yang valid atau isinya telah berubah.');
 const s=input.payload.state,base=seed();
 if(!s||s.testing?.id!==TEST_DATASET_ID)throw Error('Versi data cadangan belum didukung.');
 for(const [key,value] of Object.entries(base)){
  if(['cartMasters','pickingCartRuns','packingKolis'].includes(key)&&s[key]===undefined)continue;
  if(Array.isArray(value)&&!Array.isArray(s[key]))throw Error('Data cadangan tidak lengkap: '+key);
  if(value&&typeof value==='object'&&!Array.isArray(value)&&(!s[key]||typeof s[key]!=='object'||Array.isArray(s[key])))throw Error('Data cadangan tidak lengkap: '+key);
 }
 if(!s.items.length||!s.locations.length||!s.appUsers.some(u=>u.active&&u.roleId==='ADMIN'))throw Error('Cadangan harus memiliki master data dan administrator aktif.');
 if(!Number.isSafeInteger(s.revision)||s.revision<0)throw Error('Revisi data tidak valid.');
 return {state:migrateState(structuredClone(s)),preferences:input.payload.preferences||{}};
}
