# Mini ERP (Supabase) ↔ WMS ↔ API Moka POS

Penerimaan kini menggunakan externalResiNo + expedition sebagai identitas kiriman. packingListNo tidak diperlukan. internalResiNo tetap ID teknis untuk menjaga relasi koli, scan, kereta dan laporan lama. Tidak ada reset data.

## Status implementasi

- Server WMS memiliki konektor penarikan snapshot resi melalui RPC Supabase, pembacaan katalog/stok outlet melalui endpoint resmi Moka, dan pengiriman/pemeriksaan tanda terima outbox Supabase.
- UI menyediakan pratinjau resi, impor atomik, pratinjau stok cabang, pemeriksaan konfigurasi, antrean event dan pemeriksaan status per event.
- Pengiriman hanya aktif jika administrator memasang konfigurasi server. Paket dan site yang dibagikan tidak menyertakan secret. Status konfigurasi tersedia tidak berarti uji koneksi berhasil.
- Data operasional WMS masih di IndexedDB per browser; ini belum menjadi ledger gudang bersama/multioperator lintas perangkat. Outbox server adalah catatan integrasi, bukan pengganti ledger gudang pusat.
- Worker yang menerapkan event ke tabel Mini ERP dan yang mengirim mutasi/transfer ke Moka BELUM dapat diselesaikan tanpa skema Mini ERP, mapping SKU/outlet, aturan kepemilikan stok dan konfirmasi akses API transfer. Pengiriman WMS berhenti pada QUEUED sampai worker tersebut memberikan bukti APPLIED.
- Tidak ada koneksi produksi yang sudah diuji pada pekerjaan ini. SQL disiapkan untuk ditinjau, tidak dieksekusi.

## Data dan akses yang diperlukan

1. URL project Supabase; skema/view untuk resi, vendor, header pengiriman, detail koli, SKU, Qty dan PO; akses server yang sesuai. Jangan mengirim secret di chat. Pasang sebagai environment server atau data/integration-config.json pada komputer pengelola.
2. Token API Moka dengan izin library; business ID, ID outlet DC/cabang dan ID variant untuk setiap SKU. Persetujuan pemilik stok untuk masing-masing outlet.
3. Aturan transfer Moka: kapan stok DC berkurang dan kapan cabang bertambah (shipping atau konfirmasi tiba), dan endpoint transfer yang diizinkan untuk akun Anda. Jangan meniru transfer dengan dua adjustment tanpa kontrak yang sudah disetujui.
4. Untuk operasi serentak lintas komputer: ledger stok/reservasi dan transaksi harus dipindahkan ke Supabase dengan otorisasi pengguna server. PIN bersama dan role uji lokal belum cukup untuk otorisasi produksi.

## Konfigurasi server

WMS_INTEGRATION_ENABLED=true setelah endpoint/mapping terpasang.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVER_KEY=secret khusus server (jangan masukkan ke frontend, ZIP, git, atau chat)
MINI_ERP_RESI_RPC=nama RPC penghasil snapshot resi
WMS_OUTBOX_RPC=wms_integration_event
MOKA_ACCESS_TOKEN=token OAuth Moka di server
MOKA_OUTLET_MAP={"DC":"<id-outlet-dc>","ST01":"<id-outlet-cabang>"}
WMS_ALLOW_EVENT_SUBMIT=true hanya setelah outbox dan worker penerima diverifikasi

Komputer: salin integration-config.example.json menjadi data/integration-config.json, isi di komputer pengelola, lalu restart server. Nilai semua konfigurasi berupa string. Akses file ini tidak disajikan melalui HTTP. Hosting: gunakan environment secret Sites dan terbitkan ulang. Jangan membawa file konfigurasi yang berisi secret ketika membagikan paket ke tester.

## Kontrak sumber resi Mini ERP

RPC dipanggil POST /rest/v1/rpc/<MINI_ERP_RESI_RPC> dengan {"p_limit":50000}.
Respons wajib berupa objek:

```json
{"snapshotId":"revision-from-mini-erp","totalRows":1,"truncated":false,"rows":[{"externalResiNo":"RESI-001","vendorName":"Vendor A","shippingDate":"2026-09-07","expedition":"Ekspedisi A","totalKoli":1,"vendorKoliNo":"KOLI-001","poNumber":"PO-001","sku":"B01-097A3","qty":40}]}
```

RPC harus membaca data dalam satu snapshot konsisten. Kembalikan seluruh isi setiap resi, bukan halaman sebagian koli. Jika lebih dari batas, kembalikan truncated=true agar WMS menolak impor parsial. Hanya resi yang dirilis Mini ERP untuk penerimaan. Nilai kolom disesuaikan melalui RPC/view ke skema asli Mini ERP. SKU harus sudah ada di WMS. PO opsional, fallback ke nomor resi. Penarikan ulang tidak menggandakan kiriman. Resi lama yang isinya berubah ditahan untuk pemeriksaan; WMS tidak mengubah pemeriksaan/qty yang sudah berjalan.

## Outbox dan status

RPC wms_integration_event menerima p_action (submit/status) dan p_event {id,target,event,payload,createdAt}. ID event tetap pada setiap percobaan. Server memerlukan unique event ID dan menolak ID sama dengan payload berbeda. Skrip outbox.sql menyiapkan kontrak antrean, bukan worker pengubah data ERP/Moka.

- QUEUED: diterima outbox, UI WAITING_REMOTE; belum tersinkron.
- APPLIED + externalId: perubahan benar-benar berhasil di tujuan, UI SYNCED.
- FAILED: ditolak tujuan; periksa kesalahan pemetaan.
- NOT_FOUND: belum ada pada outbox; boleh kirim ID yang sama.
- Timeout/koneksi putus: UI UNKNOWN, cek status sebelum kirim ulang.

Worker penerima harus memakai transaksi/locking, idempotency dan rekonsiliasi. Jangan menandai APPLIED hanya karena HTTP request terkirim. Untuk timeout mutasi Moka, cek bukti transaksi tujuan sebelum retry; jangan mengulang penambahan stok secara buta. Event TRANSFER_STOCK harus memiliki bukti transfer asli sebelum APPLIED.

Event MINI_ERP: KOLI_INTAKE (resi + jumlah koli), RECEIVING (resi + koli + PO + hasil cek), PUTAWAY, SHIPPING. Event MOKA: PUTAWAY, STOCK_ADJUSTMENT, RETURN_SELLABLE, TRANSFER_STOCK. Receiving belum mengubah sellable stock Moka.

## Moka → WMS

GET https://api.mokapos.com/v1/outlets/{outlet_id}/items dengan Bearer token, Content-Type application/json, pagination page/per_page. WMS menggunakan item_variants[].sku, id dan in_stock untuk snapshot. Cocokkan SKU secara tepat; SKU kosong/ganda/tidak dikenal atau kurang menyebabkan penerapan ditolak. Stok cabang memperbarui OH saja, tidak menambah stok fisik DC atau memproduksi event pantulan. Snapshot harus ditinjau sebelum diterapkan; katalog yang lebih luas dari master WMS memerlukan pemetaan lebih dahulu.

Dokumentasi resmi yang diperiksa:
- https://api.mokapos.com/docs (OpenAPI resmi ditautkan dari halaman ini)
- https://supabase.com/docs/guides/api
- https://supabase.com/docs/guides/getting-started/api-keys

API adjustment Moka menggunakan actual_stock (stok absolut). Delta Putaway tidak boleh langsung dipakai sebagai actual_stock. API transfer tidak ditemukan pada spesifikasi publik yang diperiksa; akses akun dan alur transfer harus dikonfirmasi sebelum implementasi writer. Token tidak ditampilkan di UI atau dicatat dalam log.


## HPP per item dari Mini ERP
Format CSV/RPC mengikuti: vendorName, shippingDate, externalResiNo, expedition,
totalKoli, vendorKoliNo, poNumber, sku, qty, hpp/item.

`hpp/item` adalah harga pokok satu pcs dalam IDR, tanpa pemisah ribuan;
contoh 30000 atau 30000.50 (desimal koma juga diterima dalam CSV terkutip).
Maksimal dua desimal. Nol valid; kosong/file lama berarti belum tersedia,
bukan nol. Angka negatif atau format ambigu ditolak sebelum impor disimpan.

WMS menyimpan hppPerItem dan hppMinor (IDR x 100) pada expectedItems serta
receiptItemCosts per receiptId/koliNo/vendorKoliNo/PO/SKU. Qty adalah
qtyDeclared dari dokumen sumber. Nilai historis tidak ditimpa oleh resi baru;
snapshot ulang dengan harga berubah ditolak untuk pemeriksaan Mini ERP.

Event outbox MOKA `RECEIPT_ITEM_COSTS` membawa metadataOnly=true, currency,
nomor resi dan seluruh rincian biaya sumber. Event ini BUKAN penerimaan
stok, bukan instruksi menghitung HPP rata-rata/FIFO, dan bukan perintah
menimpa harga jual atau cost master Moka. Consumer integrasi harus memetakan
SKU ke item/variant/outlet dan menentukan pemakaian biaya sesuai kontrak
Moka yang disepakati sebelum menulis. Tidak ada endpoint penulisan cost
Moka yang diaktifkan oleh pembaruan ini. Jangan menandai APPLIED sebelum
ada bukti penerapan yang sesuai; biaya kosong tidak boleh menjadi nol.

HPP tidak ditampilkan pada layar operasional warehouse. Penyembunyian UI
bukan pembatasan akses ke file cadangan/data browser. Saat pindah ke
Supabase, terapkan izin data biaya khusus server/role berwenang.
Koneksi persisten Supabase dan consumer Moka tetap memerlukan konfigurasi.
