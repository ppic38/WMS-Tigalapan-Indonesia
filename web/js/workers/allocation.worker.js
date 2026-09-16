import {simulate} from '../lib/allocation.js';
self.onmessage=e=>{try{const rows=simulate(e.data,progress=>self.postMessage({progress}));self.postMessage({progress:100,rows})}catch(err){self.postMessage({error:err.message})}};
