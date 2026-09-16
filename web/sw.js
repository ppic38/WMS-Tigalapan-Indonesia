// Retire offline app caches. IndexedDB testing data is deliberately preserved.
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('wms38-')).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
// All requests go to the server, which validates the PIN session.
