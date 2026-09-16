# WMS 38 Tigalapan — Source

Source code WMS (Warehouse Management System) Tigalapan Indonesia. Awalnya dikembangkan sebagai
paket desktop Windows lokal (lihat `portable/`), sekarang dipindah ke repo ini untuk dikembangkan
lebih lanjut sebagai aplikasi web (hosting terpusat, terhubung ke Supabase & Mini ERP).

Lihat `README.txt` untuk catatan versi (V1–V14), dan `integration/README.md` untuk kontrak
integrasi Mini ERP (Supabase) ↔ WMS ↔ Moka POS.

## Struktur

- `src/` — komponen React (modules per fitur: Receiving, Putaway, Rack3D, dll.)
- `web/` — HTML/CSS/asset statis
- `server/` — handler `{fetch(request, env)}` (gaya Web Worker) untuk PIN gate + integration gateway
- `portable/` — paket distribusi desktop Windows (server Node lokal + launcher .bat)
- `integration/` — dokumentasi & kontrak integrasi Mini ERP / Moka POS (belum aktif)
- `tests/` — test Node (`node --test`)
- `build.mjs` — build untuk hosting Worker-style (menghasilkan `dist/`)

## Menjalankan

```bash
npm install
npm run dev    # scripts/dev-server.mjs
npm test       # node --test tests/*.test.mjs
```

## Catatan migrasi ke web

Kode `server/pin-gate.js` dan `server/integration-gateway.js` ditulis sebagai handler
`{fetch(request, env)}` gaya Cloudflare Workers — bukan Next.js/Express. Untuk deploy ke Vercel,
perlu adapter tipis yang memanggil handler ini dari Route Handler / Edge Function. Data operasional
masih di IndexedDB per browser (belum ada backend bersama) — lihat `integration/README.md` untuk
rencana ke depan.
