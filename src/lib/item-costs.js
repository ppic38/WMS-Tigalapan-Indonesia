// Receipt-level source cost metadata, never an inventory valuation policy.
export function parseItemCost(value){
 if(value==null||String(value).trim()==='')return null;
 const text=String(value).trim();
 if(!/^\d+(?:[.,]\d{1,2})?$/.test(text))throw Error('hpp/item harus angka nonnegatif tanpa pemisah ribuan, maksimal 2 desimal.');
 const [whole,fraction='']=text.replace(',','.').split('.'),minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(minor>BigInt(Number.MAX_SAFE_INTEGER))throw Error('hpp/item melebihi batas nilai yang didukung.');
 return {hppPerItem:Number(minor)/100,hppMinor:Number(minor),currency:'IDR'};
}
