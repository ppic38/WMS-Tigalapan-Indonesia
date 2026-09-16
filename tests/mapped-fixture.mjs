import {seed as originalSeed} from '../src/lib/data.js';

// Legacy workflow fixtures explicitly register the destinations used by their
// scenarios. Production seed keeps unmapped SKUs unmapped and cannot Putaway.
export function seed(){
 const s=originalSeed();
 for(const item of s.items.slice(0,3)){
  item.primaryLocation='A01-1-01';
  item.reserveLocations=['A01-1-02','B01-1-01'];
 }
 return s;
}
