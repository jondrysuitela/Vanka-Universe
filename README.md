# Vanka Universe

**A Universe of Memories. A Lifetime of Love.**

Aplikasi Next.js (App Router) untuk pengalaman ulang tahun pertama Vanka: beranda
kosmik, pengalaman sinematik ulang tahun, Arsip Privat yang dilindungi PIN, dan
panel admin untuk mengelola media, kenangan, surat, dan galeri.

Tiga babnya: **Birthday Experience** (pengalaman ulang tahun pertama),
**Memory Archive** (satu bab per ulang tahun, dapat diputar ulang oleh publik
mulai hari setelah ulang tahunnya), dan **Arsip Privat** (ruang keluarga yang
dibuka dengan PIN).

## Stack

| Lapis | Teknologi |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Cache Components) + React 19 |
| Bahasa | TypeScript (strict) |
| Gaya | Tailwind CSS 4 + Framer Motion |
| Basis data | PostgreSQL — Neon (produksi, driver HTTP stateless) atau `pg` TCP (lokal) |
| Penyimpanan media | `filesystem` (lokal) · `r2` (Cloudflare R2 + index JSON) · `db-r2` (Postgres + R2) |
| Auth | bcrypt (bcryptjs) + cookie sesi opaque; PIN arsip terpisah dari password admin |
| Uji | Vitest + @testing-library/react |

## Menjalankan secara lokal

```bash
npm install
cp .env.example .env.local   # lalu isi nilainya
npm run dev                  # http://localhost:3000
```

### Variabel environment

Semua variabel **server-side** dan tidak pernah diekspos ke client. Lihat
`.env.example` untuk daftar lengkap beserta komentar.

| Variabel | Wajib | Nilai yang diterima |
|---|---|---|
| `DB_DRIVER` | ya | `pg` (PostgreSQL lokal via TCP) · `neon` (Neon). Nilai lain → error saat start. |
| `DATABASE_URL` | ya | String koneksi PostgreSQL/Neon. |
| `MEDIA_STORAGE_DRIVER` | untuk produksi | `filesystem` (default lokal) · `r2` · `db-r2`. |
| `R2_*` | bila `r2`/`db-r2` | Kredensial & bucket Cloudflare R2. |
| `APP_ORIGIN` | disarankan | Origin publik app; dipakai untuk cek CSRF. Kosong → pakai `url.origin`. |
| `ARCHIVE_TRUSTED_PROXY_HEADER` | untuk produksi | Nama SATU header proxy yang menimpa IP klien (mis. `cf-connecting-ip`). Kosong → IP tidak dipercaya → limiter pakai bucket identity-only. |
| `BCRYPT_COST` | tidak | Default 12 (tes memakai 4). |

## Perintah

```bash
npm run dev         # server pengembangan
npm run build       # build produksi
npm run start       # jalankan hasil build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run test        # Vitest (sekali jalan)
npm run verify      # lint + typecheck + test
```

## Basis data

Proyek **tidak punya sistem migrasi**. Skema adalah rantai berkas SQL yang
berurutan; jalankan sekali, berurutan, satu berkas per transaksi:

```bash
node scripts/apply-migrations.mjs --list              # lihat rantainya
DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs
```

Rantainya (`db/schema.sql` → `db/init.sql` → 6 draft migration) dijelaskan di
[`db/MIGRATION_CHECKLIST.md`](db/MIGRATION_CHECKLIST.md) — termasuk query
verifikasi struktur (Phase 3) dan langkah rollback.

> **Penting:** berkas `db/draft_migration_*.sql` masih berstatus DRAFT dan
> **belum pernah diuji terhadap PostgreSQL nyata**. Ambil snapshot/branch Neon
> sebelum menerapkannya.

Buat akun admin pertama:

```bash
DB_DRIVER=neon DATABASE_URL='postgres://...' node scripts/create-owner.mjs
```

## Model keamanan

Dua kanal kredensial **terpisah secara konstruksi**:

| Kanal | Cookie | Tabel | Diturunkan dari |
|---|---|---|---|
| Admin | `vanka_session` | `sessions` (`admin_id`) | password admin (bcrypt) |
| Pengunjung Arsip Privat | `vanka_archive_access` | `archive_access_sessions` (tanpa `admin_id`) | PIN arsip (bcrypt) |

Sesi admin **tidak** bisa memenuhi guard pengunjung, dan sebaliknya. Mengganti
PIN menaikkan `access_version`, yang membatalkan seluruh sesi pengunjung
sekaligus.

Lapisan lain:

- **CSRF** — setiap mutasi butuh `Origin` yang cocok + `Content-Type:
  application/json` + header kustom `x-vanka-request: 1`.
- **Rate limiting** — berbasis database: per email+IP dan per IP untuk login;
  per-IP + rem global untuk PIN arsip; identity-only bila IP tak dipercaya.
- **Media privat** — tidak pernah disajikan statis dari `public/`; hanya lewat
  route terautentikasi, dan route pengunjung hanya melayani media yang
  benar-benar dirujuk galeri.
- **Hapus media** — ditolak (409) bila status referensi tidak dapat diverifikasi.

Dokumentasi rinci per domain ada di `db/` (`SCHEMA.md`, `MIGRATION_CHECKLIST.md`,
dan dokumen rencana per tahap).

## Deploy

Repo ini dikonfigurasi untuk **Vercel** (Next.js build standar). Panduan lengkap
— term migrations, environment variable, dan smoke test — ada di
[`docs/deploy.md`](docs/deploy.md).

Pastikan environment variable di dashboard Vercel terisi:

`DATABASE_URL`, `DB_DRIVER=neon`, `MEDIA_STORAGE_DRIVER`, `APP_ORIGIN`,
`ARCHIVE_TRUSTED_PROXY_HEADER` (bila ada proxy yang menyetel IP klien), dan
`R2_*` bila memakai penyimpanan R2.

> **Perhatian — penyimpanan media di Vercel.** Driver `filesystem` menyimpan
> byte di direktori lokal instance, yang bersifat ephemeral dan **tidak**
> dibagikan antar instance. Untuk produksi multi-instance, gunakan `db-r2`
> (metadata di Postgres + byte di R2) atau `r2`.

Catatan: `docs/cloudflare-deploy.md` mendokumentasikan runbook Cloudflare
Workers yang **sudah tidak berlaku** sejak migrasi ke Vercel; jangan jalankan
`wrangler deploy` dari repo ini.
