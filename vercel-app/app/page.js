// Root ("/") -- app.jsx (public/app.js) me-mount dirinya sendiri ke <div id="root"> lewat
// createRoot(...).render(<SessionGate/>) pada saat modul dimuat browser (lihat source/src/app.jsx
// baris terakhir) -- halaman ini SENGAJA cuma menyediakan wadahnya, tanpa logic React apa pun di
// sisi Next.js (single source of truth tetap app.jsx yang sama dipakai paket desktop).
export default function Page() {
  return <div id="root" />;
}
