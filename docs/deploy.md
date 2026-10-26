# Deployment runbook — Vercel

Target: deploy the Next.js 16 app to **Vercel** (standard Next.js build).

Status ringkas: **build, config, dan runtime lokal sudah terverifikasi**.
Yang belum: seluruh jalur yang butuh layanan nyata (Neon, R2) dan deploy itu
sendiri.

> Runbook Cloudflare Workers yang pernah ada di `docs/cloudflare-deploy.md` sudah
> **tidak berlaku** sejak migrasi ke Vercel (commit `c5fb249`) dan tidak boleh
> diikuti lagi. Repositori ini tidak lagi memakai OpenNext/wrangler.

Recommended working directory: repo root (`D:\PROJEK CODING\Vanka-Universe`).

---

## 0. Prerequisites

- [ ] Node.js + npm (deps already pinned; `next` 16.4.0, `react` 19.3.0)
- [ ] Akun Vercel dengan proyek terhubung ke repo GitHub ini
- [ ] Neon PostgreSQL project (production DB)
- [ ] Cloudflare R2 bucket (hanya bila penyimpanan media memakai R2)

---

## 1. Apply the database schema chain (REQUIRED, order matters)

The project has **no migration system**. The schema is a chain of SQL files and
every `db/draft_migration_*.sql` is still marked
`DRAFT - BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL`.

Apply in exactly this order:

```
db/schema.sql                                  (uuid-ossp, admins, memories, media,
                                                birthday_editions, content, audit_logs)
db/init.sql                                    (helper functions + triggers)
db/draft_migration_4c2a_auth_foundation.sql    (admins.password_hash, sessions, login_attempts)
db/draft_migration_4g26_birthday_letters.sql   (birthday_letters)
db/draft_migration_4g27_private_archive.sql    (private_archives)
db/draft_migration_4g39_archive_gallery.sql    (private_archive_media)
db/draft_migration_4g39v_archive_gallery_videos.sql (video items in private gallery)
db/draft_migration_4g40d3b_media_objects.sql   (media_objects)
db/draft_migration_4g41_archive_access.sql     (archive_access_sessions, archive_access_attempts)
db/draft_migration_4g46_birthday_music.sql     (birthday_music + audio/music media support)
```

Each draft runs in a single transaction and fails closed via its own
`DO $preflight$` block. Do NOT run two drafts concurrently.

Preferred: the bundled runner (no `psql` needed). It applies the files in the
fixed order above, one file per transaction, stops at the first failure, and
never prints `DATABASE_URL`:

```bash
DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs
# stop after a specific step:
DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs --to 4g27
# just show the chain, no connection:
node scripts/apply-migrations.mjs --list
```

Alternative, if you do have `psql` (one file per command; each draft file
already contains `BEGIN;`/`COMMIT;`, so pass `--single-transaction` for safety):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g26_birthday_letters.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g27_private_archive.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g39_archive_gallery.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g39v_archive_gallery_videos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g40d3b_media_objects.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g41_archive_access.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g46_birthday_music.sql
```

The `4g46` migration is required for birthday music uploads: it creates
`birthday_music` and extends `media_objects` to accept the `audio` kind and
`music` collection. Apply it to the production database before uploading a
song. It is additive and safe to re-run, but take a Neon branch/snapshot first
as with the other draft migrations.

No `psql` locally? Paste each file into the Neon SQL editor, one at a time, in
the same order. Take a Neon branch/snapshot first if the database already has
data.

Verification after the chain (structure, not just "no error") is described in
`db/MIGRATION_CHECKLIST.md` (Phase 3).

---

## 2. Create the owner (admin) account

```bash
# Requires DATABASE_URL + DB_DRIVER in the environment.
DB_DRIVER=neon DATABASE_URL='postgres://...' node scripts/create-owner.mjs
```

See `scripts/create-owner.mjs` for the exact flags/prompts (email, name,
password). `BCRYPT_COST` (default 12) controls hash cost.

---

## 3. Set environment variables (Vercel dashboard)

Set these in **Project → Settings → Environment Variables** (Production +
Preview). Never commit a real value.

| Variable | Value | Required |
|---|---|---|
| `DB_DRIVER` | `neon` | yes |
| `DATABASE_URL` | Neon pooled connection string (`sslmode=require`) | yes |
| `MEDIA_STORAGE_DRIVER` | `db-r2` (required for direct archive uploads) | yes for media |
| `APP_ORIGIN` | `https://<domain>.vercel.app` | strongly recommended |
| `ARCHIVE_TRUSTED_PROXY_HEADER` | the ONE header your proxy overwrites with the client IP | see §5 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 | when `r2`/`db-r2` |
| `R2_KEY_PREFIX` | e.g. `media/` — **not empty** | when `r2`/`db-r2` |
| `BCRYPT_COST` | default 12 | optional |

### R2 browser-upload CORS

Private archive media uploads use a short-lived presigned `PUT` URL when
`MEDIA_STORAGE_DRIVER=db-r2`, so the file bytes do not pass through a Vercel
Function (whose request-body limit is 4.5 MB). Configure the R2 bucket CORS
policy to allow the exact production/preview app origins that need uploads:

```json
[
  {
    "AllowedOrigins": ["https://<your-app-domain>"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Do not use `*` for origins. Add each trusted Vercel preview origin explicitly
if preview deployments need this flow. The signed URL only writes to a
temporary server-generated key; the app verifies its size, MIME metadata, and
magic bytes before copying it to the final private key and listing its record.
Other providers fail closed for this direct-upload route.

Add an R2 lifecycle rule to expire objects under
`<R2_KEY_PREFIX>pending/` after one day. Abandoned uploads remain in this
staging prefix; the opt-in media reconciliation skips their pending metadata
while staged bytes exist and can remove the row after the lifecycle rule
expires those bytes.

---

## 4. Build and deploy

```bash
npm run build    # next build -> .next/
npm run verify   # lint + typecheck + test (run this before pushing)
```

Vercel builds with the standard `next build`; no adapter is needed.

---

## 5. Post-deploy smoke test

```
/                     200
/arsip-ibu            200
/birthday-experience  200
/memory-archive       200
/admin/login          200
/admin                307 -> /admin/login   (unauthenticated)
/api/auth/me          401 (unauthenticated)
/api/archive/access   200 {"..."}          (unlocked:false)
```

Then, with real services: log in as owner, upload an image (exercises the media
store), open the private archive with the PIN, and confirm a 307 still happens
for `/admin`.

---

## Known limitations (not hidden)

1. **`MEDIA_STORAGE_DRIVER` kosong tidak fail-closed.** Nilai kosong memilih
   `filesystem` (`node:fs`), yang **tidak sah** untuk Vercel: direktori
   instance bersifat ephemeral dan tidak dibagikan antar instance, sehingga
   file yang terunggah bisa hilang. **Setel `MEDIA_STORAGE_DRIVER` secara
   eksplisit** di dashboard Vercel.
2. **Penyimpanan media di Vercel.** Untuk produksi multi-instance gunakan
   `db-r2` (metadata di Postgres + byte di R2). Upload Arsip Privat langsung
   dari browser hanya tersedia pada driver ini; provider lain akan menolak
   endpoint tersebut tanpa fallback. Driver `filesystem` hanya untuk lokal.
3. **`R2_KEY_PREFIX` kosong default ke `test/`**, sehingga objek produksi masuk
   ke prefix `test/`. Setel eksplisit untuk produksi.
4. **PIN arsip privat butuh IP klien yang tepercaya.** Tanpa
   `ARCHIVE_TRUSTED_PROXY_HEADER` yang benar, POST `/api/archive/access`
   gagal-tertutup dengan `503 ARCHIVE_ACCESS_UNAVAILABLE` **by design** — bukan
   bug. Artinya: limiter memakai bucket identity-only per email (tetap membatasi
   tebakan, tapi satu klien tidak bisa mengunci akun orang lain).
5. **Migrasi belum terverifikasi terhadap PostgreSQL nyata** (lihat langkah 1).
   Rantainya masih bisa memunculkan cacat yang hanya terlihat saat dieksekusi.
6. **Tidak ada sistem migrasi/versi.** Menjalankan rantai berkas dua kali
   aman secara umum (semua `IF NOT EXISTS`), tetapi tidak ada riwayat versi
   yang bisa mendeteksi drift.
