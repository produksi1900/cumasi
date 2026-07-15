# FetSipedas Web

## Cara deploy ke GitHub Pages

1. Buat repository baru di GitHub (boleh public), misalnya `fetsipedas-web`.
2. Upload SEMUA file di folder ini (`index.html`, `style.css`, `app.js`,
   `config.js`, `sph-config.js`) ke root repository itu.
   - Paling gampang: di halaman repo GitHub, klik "Add file" -> "Upload files",
     drag semua file sekaligus, lalu "Commit changes".
3. Buka tab **Settings** repo -> menu **Pages** (di sidebar kiri).
4. Di bagian **Source**, pilih branch `main` dan folder `/ (root)`, klik **Save**.
5. Tunggu 1-2 menit, GitHub akan kasih URL seperti:
   `https://<username-github-anda>.github.io/fetsipedas-web/`
6. Buka URL itu -> coba login pakai akun `prov` atau `bps1901` dst yang sudah
   dibuat di Supabase Authentication.

## Yang sudah bisa dicoba sekarang
- Login (role prov & kabkot, dengan hak akses beda sesuai RLS Supabase)
- Panel Rekon: pilih jenis SPH, tahun, kabupaten, komoditi, tab
  (Provitas Habis/Belum/Harga atau Provitas/Harga utk BST) -> tabel +
  grafik + highlight outlier kuning
- Info "data terakhir diperbarui" (dari tabel `sync_meta`)

## Yang BELUM bisa jalan sampai Edge Function `sync-sph` di-deploy
- Tombol Download (SBS/BST/TBF/TH) di panel kiri (khusus akun `prov`).
  Kalau diklik sebelum Edge Function ada, akan muncul pesan error yang jelas
  di kotak log, bukan bikin web-nya rusak/nge-hang.

## Catatan keamanan
- `config.js` isinya Project URL + `sb_publishable_...` key — ini AMAN
  dipublikasikan di GitHub, memang didesain untuk dipakai di sisi browser.
- Yang TIDAK PERNAH ada di sini: `service_role key` Supabase, dan
  username/password sipedas.pertanian.go.id asli. Itu semua nanti hanya
  ada di Supabase Edge Function Secrets (langkah berikutnya).
