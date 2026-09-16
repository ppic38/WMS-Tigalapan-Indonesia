# Audit paralel WMS — 9 September 2026

118 pengujian logika Node lulus, termasuk siklus receiving sampai shipping dan interleaving beberapa operator. Tiga pemeriksaan render server (cart, phase1, outbound) lulus. Build produksi berhasil.

Perbaikan:
- Sesi checking koli menolak operator lain selama sesi pemilik berjalan atau dijeda.
- Kereta putaway memeriksa pemilik saat mulai dan simpan. Satu operator hanya mempunyai satu kereta putaway aktif.
- Antrean menampilkan operator dan menonaktifkan pilihan yang dimiliki operator lain.
- Pilihan user testing memakai sessionStorage per tab agar reload tidak mengikuti pilihan user di tab lain.

Skenario paralel:
- Dua operator menerima koli berbeda dalam resi yang sama; penerimaan duplikat ditolak.
- Dua operator checking koli berbeda; pause tidak melepas kepemilikan sesi.
- Putaway kereta pertama berjalan saat koli kedua masih diperiksa.
- Dua kereta putaway berbeda berjalan; menyelesaikan satu tidak menutup sesi operator lain.
- Picking batch kedua berjalan saat batch pertama dipacking dan dikirim.
- Dua packer bersaing mengambil sisa kereta; scan dengan qty yang sudah habis ditolak.
- Pengiriman ulang ditolak; stok, reservasi, jejak task dan jumlah outbox tetap konsisten.

Batas verifikasi:
Pengujian interleaving memakai mutation state yang sama, bukan perangkat fisik bersamaan. Data aplikasi tetap IndexedDB per origin/browser; transaksi baca-tulis terserialisasi dan BroadcastChannel memperbarui tab. Belum ada backend bersama untuk browser/perangkat berbeda. Supabase, Mini ERP dan Moka belum terhubung. User testing bukan autentikasi per-orang. Pengujian browser interaktif terhalang kebijakan URL lingkungan; scanner, kamera dan Windows belum diuji fisik. Tidak ada reset data atau perubahan dataset ID.

## Putaway satu lokasi aktif — 11 September 2026

- Tabel isi kereta dibatasi ke SKU, qty di kereta, lokasi utama, dan aksi.
- Setelah SKU dipindai, sistem menampilkan tepat satu lokasi: utama selama masih memiliki kapasitas, lalu reserve terdekat jika utama penuh atau diblokir.
- Operator mengetik qty; scan lokasi harus sama dengan lokasi aktif. Stok bertambah dalam transaksi yang sama setelah scan berhasil.
- Perubahan kapasitas akibat transaksi user lain diperiksa ulang saat simpan; scan lama ditolak tanpa mutasi.
- Kereta tetap eksklusif per operator, sedangkan operator berbeda dapat memproses kereta berbeda bersamaan.
- 119 pengujian logika dan tiga pemeriksaan render terkait lulus.
