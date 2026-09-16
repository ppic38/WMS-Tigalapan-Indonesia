let loading;
export async function loadBarcodeReader(){
 if(globalThis.ZXing)return globalThis.ZXing;
 if(!loading)loading=new Promise((resolve,reject)=>{
  const script=document.createElement('script');let timer;
  const fail=()=>{clearTimeout(timer);script.remove();loading=null;reject(Error('Pemindai foto perlu koneksi internet saat pertama dimuat. Gunakan input nomor atau scanner handheld.'))};
  script.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  script.onload=()=>{clearTimeout(timer);globalThis.ZXing?resolve(globalThis.ZXing):fail()};script.onerror=fail;timer=setTimeout(fail,15000);document.head.appendChild(script);
 });return loading;
}
export async function decodeBarcodeImage(image){
 if(globalThis.BarcodeDetector){
  let codes=[];try{codes=await new globalThis.BarcodeDetector().detect(image)}catch{}
  const values=[...new Set(codes.map(c=>c.rawValue).filter(Boolean))];
  if(values.length>1)throw Error('Ada beberapa barcode. Foto satu label saja agar nomor tidak tertukar');
  if(values.length===1)return values[0];
 }
 const ZXing=await loadBarcodeReader(),reader=new ZXing.BrowserMultiFormatReader();
 try{return (await reader.decodeFromImageElement(image)).getText()}
 catch{throw Error('Barcode/QR belum terbaca. Foto lebih dekat dengan satu label, atau input nomornya')}
 finally{reader.reset()}
}
export async function readBarcodePhoto(file){
 if(!file?.type.startsWith('image/'))throw Error('Pilih file foto barcode/QR');
 if(file.size>12*1024*1024)throw Error('Ukuran foto maksimal 12 MB');
 const url=URL.createObjectURL(file);
 try{const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Foto tidak dapat dibuka. Gunakan JPG atau PNG'));img.src=url});return await decodeBarcodeImage(image)}
 finally{URL.revokeObjectURL(url)}
}
