import {checkingQueue} from './carts.js';

// Completed records stay in state for reports; only the operational view changes.
export function receivingQueues(s){
 const byReceipt=new Map();
 for(const k of s.kolis){if(!byReceipt.has(k.internalResiNo))byReceipt.set(k.internalResiNo,[]);byReceipt.get(k.internalResiNo).push(k)}
 const intakes=s.receipts.filter(r=>!r.intakeConfirmedAt&&(byReceipt.get(r.internalResiNo)||[]).some(k=>['PENDING','CHECKING'].includes(k.status)));
 const pendingKolis=intakes.flatMap(r=>(byReceipt.get(r.internalResiNo)||[]).filter(k=>!k.arrivedAt&&['PENDING','CHECKING'].includes(k.status)));
 const confirmations=intakes.filter(r=>{const ks=byReceipt.get(r.internalResiNo)||[];return ks.length===r.expectedKoli&&ks.every(k=>k.arrivedAt)});
 const checking=checkingQueue(s);
 return {intakes,pendingKolis,confirmations,checking,count:pendingKolis.length+confirmations.length+checking.length};
}
