# Jericho Community

Starter project website belajar dengan 4 fitur: catatan, belajar dengan Gemini, latihan soal interaktif, dan chat Master.

## Prasyarat
- Node.js 18 atau lebih baru
- Gemini API key dari Google AI Studio
- (Opsional) Google Cloud project dengan Google Drive API dan OAuth 2.0 Web application

## Menjalankan
1. Ekstrak folder proyek.
2. Jalankan `npm install`.
3. Salin `.env.example` menjadi `.env`.
4. Isi `GEMINI_API_KEY` di `.env`.
5. Jalankan `npm start`.
6. Buka `http://localhost:3000`.

## Google Drive OAuth
1. Di Google Cloud Console, buat project dan aktifkan Google Drive API.
2. Buat OAuth Client ID tipe Web application.
3. Tambahkan Authorized redirect URI yang sama persis dengan `GOOGLE_REDIRECT_URI`, default `http://localhost:3000/auth/google/callback`.
4. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_REDIRECT_URI` di `.env`.
5. Jalankan ulang server, lalu klik Hubungkan Google Drive.

Aplikasi meminta scope `drive.file`, yaitu akses untuk file yang dibuat/dibuka melalui aplikasi. Saat pengembangan, akun Google mungkin perlu ditambahkan sebagai test user pada OAuth consent screen.

## Catatan keamanan penting
- Jangan pernah commit atau membagikan file `.env`.
- Jangan menaruh Gemini API key di frontend.
- Contoh ini menggunakan penyimpanan sesi OAuth di memory server dan mengirim ID sesi sementara melalui URL saat callback. Ini untuk prototipe lokal, bukan deployment publik. Untuk produksi, ganti dengan session store server-side yang persisten, cookie `HttpOnly`, `Secure`, `SameSite`, validasi OAuth state/PKCE yang lengkap, HTTPS, rate limiting, dan perlindungan CSRF.
- OAuth refresh token yang disimpan hanya di memory akan hilang saat server restart; pengguna dapat menghubungkan ulang. Untuk produksi, simpan token terenkripsi dan terlindungi.
- Koneksi AI memerlukan internet dan API key yang valid. Model di `GEMINI_MODELS` dapat diubah sesuai model yang tersedia pada akun/API saat digunakan.

## Fitur lokal
Catatan dan draft disimpan di browser menggunakan localStorage. Jangan gunakan perangkat bersama untuk menyimpan informasi sensitif.
