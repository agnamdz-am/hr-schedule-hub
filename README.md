# HR Schedule Hub

Aplikasi web untuk mengatur jadwal tim HR: **interview rekrutmen, training, acara perusahaan, dan cuti karyawan** dalam satu menu Jadwal (tampilan kalender dan daftar). Dibuat sebagai proyek portofolio dengan Node.js, memakai data fiktif **PT Gna Ascend Indonesia**.

Masalah yang diselesaikan: jadwal HR sering tabrakan. Satu interviewer dijadwalkan di dua interview pada jam yang sama, ruang rapat dipakai dua kegiatan, atau peserta training ternyata sedang cuti. Aplikasi ini menolak jadwal seperti itu sebelum tersimpan, dan menjelaskan alasannya.

**Live demo: https://hr-schedule-hub.vercel.app** (klik salah satu akun contoh di halaman login, kata sandi `password123`)

Catatan: demo berjalan di hosting gratis, jadi data bisa kembali ke data awal sewaktu-waktu. Itu normal.

![Cek bentrok saat menambah jadwal](docs/screenshots/04-cek-bentrok.png)

## Fitur

- **Dua akun login saja, Admin HR dan Manager HR**, dengan pemisahan tugas. Admin HR bekerja sehari-hari (jadwal, mengajukan cuti, rekrutmen, data karyawan). Manager HR memutuskan: semua persetujuan cuti dan penawaran kerja. Karyawan lain tidak butuh akun, cukup tercatat di data karyawan.
- **Data karyawan satu tempat** (menu Karyawan: tambah, ubah, nonaktifkan). Semua form memilih nama dari daftar ini, dan nama, jabatan, divisi, serta sisa cuti terisi otomatis. Karyawan yang dinonaktifkan hilang dari pilihan form, tetapi riwayatnya tetap ada.
- **Jadwal**: satu menu dengan dua tampilan (Kalender dan Daftar). Form acara/training cukup penanggung jawab, jumlah peserta, ruang, dan waktu. Form interview memilih kandidat dari menu Rekrutmen dan pewawancara dari daftar karyawan.
- **Deteksi bentrok** untuk pewawancara/penanggung jawab, ruangan, kapasitas ruangan (dihitung dari jumlah peserta), dan yang sedang cuti.
- **Cuti dengan alur persetujuan**: Admin HR memilih karyawan dari daftar dan mengajukan, Manager HR menyetujui. Ada sisa kuota tahunan dan aturan satu orang per divisi yang boleh cuti bersamaan. Tidak ada yang bisa menyetujui cutinya sendiri; cuti Manager HR diproses Admin HR supaya tidak buntu.
- **Rekrutmen**: lowongan, papan kandidat dari Dilamar sampai Diterima, dan penilaian interview. Admin HR mengisi penilaian atas nama pewawancara yang tercatat di jadwal interview kandidat itu (tercatat siapa yang menginput). Aturan tahapan dijaga server: tahap tidak bisa dilompati, ke Interview User butuh penilaian HR yang merekomendasikan lanjut, ke Penawaran butuh penilaian Interview User dengan rata-rata skor minimal 3, penawaran hanya diputuskan Manager HR, kuota lowongan otomatis menutup, dan menolak wajib beralasan.
- **Dashboard**: interview minggu ini, training mendatang, siapa yang cuti hari ini, pengajuan yang menunggu, dan pemakaian ruangan.
- Tampilan responsif (HP sampai desktop) dan mendukung mode gelap.

| Dashboard | Kalender |
|---|---|
| ![Dashboard](docs/screenshots/02-dashboard.png) | ![Kalender](docs/screenshots/03-kalender.png) |

## Tech stack

| Bagian | Pilihan |
|---|---|
| Server | Node.js 22.13+, Express 5 |
| Database | SQLite lewat modul bawaan Node.js `node:sqlite` (satu file, tanpa paket tambahan) |
| Autentikasi | JWT di cookie `httpOnly`, password di-hash dengan `bcryptjs` |
| Keamanan | `helmet` (CSP), `express-rate-limit`, validasi input manual |
| Frontend | HTML, CSS, dan JavaScript biasa (tanpa framework, tanpa build step) |
| Tes | `node:test` bawaan Node.js |

## Menjalankan di komputer sendiri

Butuh Node.js versi 22.13 atau lebih baru (modul `node:sqlite` baru bisa dipakai tanpa flag mulai versi itu). Cek dengan `node -v`.

```bash
npm install
npm start
```

Buka http://localhost:3000. Saat pertama kali dijalankan, database dibuat di `data/hr.db` dan diisi data fiktif otomatis.

Konfigurasi opsional lewat file `.env` (contoh ada di `.env.example`).

### Akun demo

Kedua akun memakai kata sandi `password123`. Di halaman login ada daftar akun yang bisa diklik.

| Email | Peran |
|---|---|
| `agna@gnaascend.test` | Manager HR (menyetujui cuti dan penawaran) |
| `indah@gnaascend.test` | Admin HR (mengelola jadwal, cuti, rekrutmen, karyawan) |

Karyawan lain (17 orang di data fiktif) tidak punya akun login.

### Skenario yang bisa dicoba

1. Masuk sebagai **Indah**, buka Jadwal, lalu tambah interview Selasa pukul 10:30 dengan pewawancara Bagas. Ditolak karena Bagas sudah ada interview 10:00 sampai 11:00.
2. Buka Cuti, pilih **Salsa** dari daftar, lalu ajukan cuti tahunan 15 hari kerja. Ditolak karena sisa kuota tidak cukup.
3. Ajukan cuti 2 hari untuk Salsa, lalu masuk sebagai **Agna** dan setujui. Setelah itu pengajuan cuti Marketing lain di tanggal yang sama akan ditolak.
4. Rekrutmen: buka kartu Alya, isi penilaian atas nama pewawancara, pindahkan ke Penawaran, lalu masuk sebagai **Agna** untuk menyetujui penawaran.
5. Buka Karyawan, tambah karyawan baru, lalu lihat namanya langsung muncul di semua form.

### Perintah lain

```bash
npm test         # jalankan semua tes
npm run seed     # kosongkan database lalu isi ulang dengan data fiktif
npm run dev      # jalankan server dengan auto-reload
```

Tanggal pada data fiktif dihitung relatif terhadap minggu saat database diisi, supaya kalender selalu terisi. Jalankan `npm run seed` lagi bila datanya sudah terasa lama.

## Struktur proyek

```
src/
  server.js          titik masuk, mengisi data demo bila database kosong
  app.js             Express: middleware keamanan, routing, error handler
  db.js              koneksi SQLite dan fungsi baca/tulis
  schema.sql         definisi tabel
  logic.js           aturan bisnis (bentrok, kuota cuti, hak persetujuan)
  recruit.js         aturan tahapan kandidat dan penilaian (dipakai server dan browser)
  validate.js        validasi dan pembersihan input (jadwal, cuti, karyawan)
  seed.js            data fiktif PT Gna Ascend Indonesia
  middleware/auth.js verifikasi cookie sesi dan pengecekan peran
  routes/            auth, events, leaves, recruit, employees
public/              frontend (index.html, app.js, styles.css)
test/                tes unit dan tes API
docs/screenshots/    gambar untuk README
```

## Desain database

```mermaid
erDiagram
  employees ||--o| users : "punya akun (opsional)"
  employees ||--o{ leaves : cuti
  employees ||--o{ event_participants : dicek_bentrok
  employees ||--o{ events : penanggung_jawab
  events ||--o{ event_participants : punya
  rooms ||--o{ events : dipakai
  jobs ||--o{ candidates : dilamar
  candidates ||--o{ evaluations : dinilai
  employees ||--o{ evaluations : pewawancara
  users ||--o{ evaluations : menginput
  candidates ||--o{ events : diwawancarai
  employees {
    int id PK
    text name
    text division
    text title
    int quota "jatah cuti tahunan"
    int used_before
    int active "0 = nonaktif"
  }
  users {
    int id PK "sama dengan employees.id"
    text email UK
    text password_hash
    text role "hr_manager | admin"
  }
  rooms {
    text id PK
    text name
    int cap
  }
  events {
    int id PK
    text type "interview | training | company"
    text title
    int owner_id FK "penanggung jawab"
    int attendees "jumlah peserta"
    text event_date
    text start_time
    text end_time
    text room_id FK
    int all_hands
  }
  event_participants {
    int event_id FK
    int employee_id FK
  }
  leaves {
    int id PK
    int employee_id FK
    text type "tahunan | sakit | izin"
    text start_date
    text end_date
    text status "pending | approved | rejected"
    int submitted_by FK "Admin HR"
    int decided_by FK "Manager HR"
  }
  evaluations {
    int id PK
    int candidate_id FK
    int interviewer_id FK
    int recorded_by FK
    text stage
    int score
    text recommend
  }
```

Data karyawan (`employees`) dipisah dari akun login (`users`): hanya Admin HR dan Manager HR yang punya akun. Untuk interview, `event_participants` berisi pewawancara; untuk training dan acara berisi penanggung jawab, sedangkan peserta cukup berupa jumlah (`attendees`) yang dipakai memeriksa kapasitas ruang.

## API

Semua endpoint selain login butuh cookie sesi. Respons error berbentuk `{ "error": "pesan" }`.

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| POST | `/api/auth/login` | publik | Login, mengatur cookie sesi |
| POST | `/api/auth/logout` | publik | Menghapus cookie sesi |
| GET | `/api/auth/me` | login | Data pengguna saat ini |
| GET | `/api/auth/demo` | publik | Daftar akun contoh (mati bila `DEMO_MODE=false`) |
| GET | `/api/bootstrap` | login | Pengguna, karyawan, ruangan, jadwal, dan cuti sekaligus |
| GET | `/api/events` | login | Daftar jadwal |
| POST | `/api/events` | Admin HR | Membuat jadwal (interview: `people` = pewawancara; training/acara: `ownerId` + `attendees`) |
| PUT | `/api/events/:id` | Admin HR | Mengubah jadwal |
| DELETE | `/api/events/:id` | Admin HR | Menghapus jadwal |
| GET | `/api/employees` | login | Daftar karyawan |
| POST | `/api/employees` | Admin HR | Menambah karyawan |
| PUT | `/api/employees/:id` | Admin HR | Mengubah atau menonaktifkan karyawan (yang punya akun login tidak bisa dinonaktifkan) |
| GET | `/api/recruit` | login | Lowongan, kandidat, dan penilaian |
| POST | `/api/recruit/jobs` | Admin HR | Menambah lowongan |
| POST | `/api/recruit/candidates` | Admin HR | Menambah kandidat (duplikat email per lowongan ditolak) |
| POST | `/api/recruit/candidates/:id/move` | Admin HR; Manager HR untuk Penawaran | Memindahkan tahap atau menolak (`to`, `reason`) |
| POST | `/api/recruit/candidates/:id/evaluations` | Admin HR | Mengisi penilaian atas nama pewawancara (`interviewerId`, skor 1-5, rekomendasi) |
| GET | `/api/leaves` | login | Daftar pengajuan cuti |
| POST | `/api/leaves` | Admin HR | Mengajukan cuti atas nama karyawan (`employeeId`) |
| POST | `/api/leaves/:id/approve` | Manager HR (Admin HR hanya untuk cuti Manager HR) | Menyetujui |
| POST | `/api/leaves/:id/reject` | Manager HR (Admin HR hanya untuk cuti Manager HR) | Menolak, dengan `note` opsional |

Kode status: `400` input tidak valid, `401` belum login, `403` tidak berwenang, `404` tidak ditemukan, `409` bentrok atau melanggar aturan (isi `conflicts` atau `errors` menjelaskan alasannya).

## Keputusan teknis

**Bentrok dicek di server, bukan hanya di browser.** Browser menampilkan pratinjau instan supaya pengguna langsung tahu masalahnya, tetapi yang menentukan adalah server. Permintaan yang dikirim langsung lewat `curl` pun tetap ditolak. Data yang dipakai browser bisa juga sudah basi, misalnya admin lain baru saja menambah jadwal, sehingga keputusan akhir harus ada di satu tempat yang memegang data terbaru.

**Satu file aturan untuk dua sisi.** `src/logic.js` berisi fungsi murni tanpa akses database atau jaringan. File yang sama dimuat Node.js di server dan dikirim ke browser, jadi pratinjau dan keputusan server tidak pernah berbeda. Karena murni, fungsi-fungsi ini mudah dites tanpa menyalakan server.

**Pengecekan dan penyimpanan tidak bisa disela.** `node:sqlite` bersifat sinkron, jadi urutan "baca data, periksa bentrok, simpan" di satu proses berjalan tanpa disela permintaan lain. Penyimpanan jadwal beserta pesertanya dibungkus transaksi (`BEGIN IMMEDIATE`) supaya tidak ada jadwal setengah jadi. Bila aplikasi dijalankan lebih dari satu proses, perlu kunci tulis atau database server seperti PostgreSQL.

**Sesi lewat cookie `httpOnly`.** JavaScript di halaman tidak bisa membaca token, sehingga celah XSS tidak otomatis membocorkan sesi. Cookie memakai `SameSite=Lax` dan menjadi `Secure` di produksi.

**Hal keamanan lain.** Password disimpan sebagai hash bcrypt. Login dibatasi 10 percobaan gagal per 15 menit per IP. Login memakai hash palsu bila email tidak ada, supaya waktu respons tidak membocorkan email mana yang terdaftar. Pengguna diambil ulang dari database di setiap permintaan, jadi perubahan peran langsung berlaku. Semua input divalidasi di `validate.js`, dan query memakai parameter terikat. Header CSP dari `helmet` memblokir script dari luar.

**Tanggal sebagai teks `YYYY-MM-DD`.** Dengan begitu perbandingan tanggal cukup memakai urutan teks dan tidak ada kejutan zona waktu. Hitungan "hari ini" di server memakai zona waktu perusahaan (`APP_TIMEZONE`), bukan zona waktu mesin server.

## Tes

`npm test` menjalankan 51 tes:

- **Unit** (`test/logic.test.js`): tabrakan orang, ruangan, kapasitas, jadwal berurutan yang tidak dianggap bentrok, hitungan hari kerja, kuota cuti, aturan satu divisi, dan siapa yang boleh menyetujui.
- **Rekrutmen** (`test/recruit.test.js`): aturan tahapan dan penilaian, penilaian atas nama pewawancara terdaftar, penolakan duplikat dan lowongan tutup, serta alur lengkap dari penilaian sampai persetujuan Manager HR.
- **API** (`test/api.test.js`): server sungguhan dengan database di memori. Mencakup login, hak akses per peran, penolakan bentrok tanpa menyimpan apa pun, validasi input, kapasitas ruang dari jumlah peserta, alur persetujuan cuti, dan pengelolaan karyawan.

## Deploy

Demo online berjalan di Vercel (lihat `vercel.json` dan `api/index.js`; database ada di memori sementara dan diisi ulang otomatis). Aplikasi juga bisa berjalan di platform Node.js lain (Render, Railway, Fly.io). Yang perlu diatur:

1. Isi `JWT_SECRET` dengan string acak panjang. Server menolak start di produksi tanpa ini.
2. Set `NODE_ENV=production` dan `TRUST_PROXY=true`.
3. SQLite menyimpan data di satu file. Pasang disk persisten dan arahkan `DB_PATH` ke sana. Tanpa disk persisten, data kembali ke awal setiap kali server restart. Itu cukup untuk demo portofolio karena data diisi ulang otomatis.
4. `DEMO_MODE=true` menampilkan akun contoh di halaman login. Cocok untuk demo dengan data fiktif, matikan bila dipakai sungguhan.

## Keterbatasan dan rencana pengembangan

- Token sesi tidak bisa dicabut dari server sebelum kedaluwarsa (8 jam). Logout hanya menghapus cookie di browser.
- Belum ada upload CV, email otomatis ke kandidat, atau riwayat perubahan tahap (audit log).
- `node:sqlite` masih berstatus eksperimental di Node.js 22 dan 24. Skrip npm sudah menyembunyikan peringatannya, tetapi API-nya bisa berubah di versi mendatang.
- Belum ada ganti password atau reset password. Akun login hanya dua dan dibuat lewat data awal.
- Struktur database berversi (`PRAGMA user_version`). Bila versinya naik, tabel lama dihapus dan dibuat ulang dari data fiktif. Itu aman untuk demo, tetapi aplikasi sungguhan memerlukan migrasi.
- Belum ada pengingat email H-1 dan jadwal berulang.
- Semua data dimuat sekaligus. Untuk data besar perlu filter tanggal dan paginasi di API.
- Pindah ke PostgreSQL bila perlu lebih dari satu proses server. Query saat ini tersebar di `src/db.js`, `src/routes/`, dan `src/middleware/auth.js`, jadi sebaiknya dirapikan dulu menjadi satu lapisan akses data.

## Cerita teknis untuk wawancara

Kalau ditanya "bagian tersulit apa?", jawabannya ada di deteksi bentrok:

1. Dua rentang waktu bentrok bila `mulaiA < selesaiB && mulaiB < selesaiA`. Dengan batas tegas seperti itu, interview 10:00 sampai 11:00 dan 11:00 sampai 12:00 tidak dianggap bentrok.
2. Satu jadwal bisa bentrok dengan beberapa hal sekaligus (orang, ruangan, cuti, kapasitas), jadi fungsi mengembalikan daftar masalah, bukan hanya benar atau salah.
3. Saat mengubah jadwal, jadwal itu sendiri harus dikecualikan dari pengecekan, kalau tidak setiap perubahan akan bentrok dengan versi lamanya.
4. Cuti butuh pemeriksaan dua kali: saat diajukan dan saat disetujui, karena cuti rekan satu divisi bisa disetujui di antara keduanya.
