# Kart Friends

Game balap kart arcade orisinal di browser dengan kamera 3D di belakang kart. Buat ruang dan bagikan kode 5 karakter untuk bermain dengan maksimal 8 orang, atau mulai sendiri. Host memulai balapan; setiap ronde terdiri dari 3 lap. Pembalap yang finis tetap dapat menonton sampai hasil akhir, lalu host dapat mengulang balapan dalam ruang yang sama.

## Jalankan

Butuh Node.js 20+. Three.js dipasang secara lokal; game tidak memuat library dari CDN dan tidak membutuhkan proses build.

```sh
npm ci
npm start
```

Buka `http://localhost:3217`. Untuk ponsel dalam jaringan lokal, buka alamat IP komputer pada port yang sama. `PORT` dan `HOST` dapat diatur lewat environment bila diperlukan. Saat dipasang pada domain publik, gunakan HTTPS dan teruskan koneksi WebSocket di `/ws` melalui reverse proxy.

## Kontrol

| Aksi | Keyboard | Ponsel |
|---|---|---|
| Gas | ↑ atau W | GAS |
| Rem / mundur | ↓ atau S | REM |
| Belok | ←/→ atau A/D | ◀/▶ |
| Drift | Shift | — |
| Pakai item | Spasi atau E | Tombol item |

Item diambil dengan melewati kotak pada lintasan. Setiap pembalap menyimpan satu item: **boost** mempercepat kart selama 2,2 detik, **shield** melindungi selama 5 detik, dan **jebakan** diletakkan di belakang kart. Kotak item muncul kembali setelah 8 detik.

## Desain teknis

- Satu proses Node menyimpan ruang sementara di memori. Ruang hilang saat server berhenti; pemain yang putus kehilangan tempatnya.
- Server berjalan pada 60 tick/detik dan mengirim snapshot sekitar 20 kali/detik. Browser mengirim input 60 kali/detik, langsung memprediksi gerak kart sendiri memakai rumus fisika yang sama, kemudian mengoreksi terhadap snapshot server. Kart lain diinterpolasi agar terlihat halus.
- Checkpoint harus dilewati berurutan sebelum garis start menambah lap. Hasil dihitung oleh server dari waktu finis; setelah 180 detik, pembalap yang belum finis dicatat DNF.
- Kode ruang dibuat secara acak, nama dibatasi 16 karakter, ruang dibatasi 8 pembalap, dan hanya host yang dapat memulai ronde.
- Lintasan, kart, pepohonan, dan item 3D dibangun dari geometri kode; Three.js disajikan oleh server sendiri. Browser tanpa WebGL2 memakai tampilan Canvas 2D sebagai cadangan.
- Renderer 3D membatasi resolusi piksel, menyesuaikannya berdasarkan waktu frame, memakai instancing untuk objek berulang, dan tidak memakai efek pascaproses berat. Angka FPS, draw call, jumlah segitiga, dan rasio piksel tersedia di `data-*` pada elemen canvas untuk pengujian.

## Uji

```sh
npm test
```

Uji manual singkat: buka dua tab, buat ruang, gabung dengan kode, mulai dari tab host, ambil dan pakai item, selesaikan tiga lap, lalu pilih **Balap lagi**. Untuk ponsel, buka alamat server yang sama dan periksa kontrol sentuh serta tata letak.
