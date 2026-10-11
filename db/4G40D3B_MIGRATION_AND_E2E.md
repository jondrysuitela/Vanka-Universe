# 4G.40D-3D0 — Migration & Integration Runbook (media_objects + R2)

**Status: DRAFT / PREPARED / NOT EXECUTED.** Tidak ada migrasi, upload, atau
operasi R2 yang dijalankan. Setiap langkah butuh izin eksplisit.

Target:
- DB branch Neon: `test-arsip-ibu` (JANGAN produksi).
- Tabel: `public.media_objects` (draft `db/draft_migration_4g40d3b_media_objects.sql`).
- Bucket R2: `vanka-universe-test` (Public Access Disabled).
- Endpoint aplikasi lokal: `http://localhost:3000` (server yang sudah berjalan).

> **Penting:** provider Opsi 2 (`createDbMediaStore` + `createR2ObjectClient`) kini
> terdaftar sebagai driver **`db-r2`** (Tahap 4G.40D-4), tetapi **default tetap
> `filesystem`** dan belum ada environment mana pun yang menyalakannya. Jangan
> menyalakan `MEDIA_STORAGE_DRIVER=r2` (itu store r2-index lama, bukan Opsi 2).
> Untuk menguji Opsi 2 set `MEDIA_STORAGE_DRIVER=db-r2` (membutuhkan DB +
> konfigurasi R2 lengkap; gagal tertutup bila kurang).

---

## 0. Prasyarat yang harus dikonfirmasi dulu

Alat klien (read-only cek lokal): `psql`, `neonctl`, `wrangler`, `cloudflared`,
`npx` **belum tersedia** di mesin ini. Migrasi harus lewat **Neon SQL Editor**
(browser) atau memasang klien (butuh izin).

Kredensial R2 (nama variabel; JANGAN pernah dicetak):
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
(+ opsional `R2_ENDPOINT`, `R2_KEY_PREFIX`, `R2_METADATA_KEY`).

### 0.1 Cek prasyarat branch (read-only, SQL Editor)
```sql
-- fondasi
select to_regprocedure('update_updated_at_column()');
select to_regclass('public.admins');
-- migrasi Arsip Ibu
select to_regclass('public.private_archives');
select to_regclass('public.private_archive_media');   -- NULL = 4g39 belum ada
-- target media_objects
select to_regclass('public.media_objects');            -- NULL = belum ada
```
Catatan: `uuid-ossp` **tidak** diperlukan oleh `4g40d3b` (tabel tidak memakai
`uuid_generate_v4()`). Kalau `4g39` belum ada, lihat `db/4G39D_MIGRATION_AND_E2E.md`.

---

## 1. Urutan migrasi

1. `db/draft_migration_4g39_archive_gallery.sql` (Arsip Ibu) — kalau belum ada.
2. `db/draft_migration_4g40d3b_media_objects.sql` (metadata media).

Aturan:
- Satu berkas = satu transaksi (`BEGIN … COMMIT`). Jangan potong per-statement.
- **Jangan** jalankan lewat driver `neon()` HTTP aplikasi (multi-statement tidak
  didukung). Pakai SQL Editor Neon atau psql.

---

## 2. Verifikasi skema

Setelah `4g39`:
```sql
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='private_archive_media'
 order by ordinal_position;
select count(*) from public.private_archive_media;   -- expect 0
```

Setelah `4g40d3b`:
```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public' and table_name='media_objects'
 order by ordinal_position;
-- expect: id, status(default 'pending'), storage_provider, storage_key,
--         mime_type, kind, file_size, display_name, owner_id, owner_label,
--         title, description, taken_at, created_at, updated_at

select conname, pg_get_constraintdef(oid)
  from pg_constraint where conrelid='public.media_objects'::regclass
 order by conname;
-- expect: pkey(id), FK owner_id->admins ON DELETE SET NULL,
--         chk_media_objects_status/kind/size/provider

select indexname from pg_indexes
 where schemaname='public' and tablename='media_objects' order by indexname;
-- expect: media_objects_pkey, idx_media_objects_status/created_at/owner

select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relname='media_objects' and not t.tgisinternal;
-- expect: trg_media_objects_updated_at

select count(*) from public.media_objects;  -- expect 0
select count(*) from public.media;          -- tetap 0, tidak berubah
```
Migrasi sudah punya blok `$structure$` yang membatalkan transaksi kalau
`media_objects` sudah ada tetapi bentuknya salah — jalankan ulang aman (idempotent
untuk struktur).

---

## 3. Environment shell terpisah (TANPA mengubah `.env.local`)

Arahkan proses dev kedua ke branch + R2 lewat env shell, bukan file.
```powershell
# Proses dev terpisah (biarkan server lain tetap jalan)
$env:DB_DRIVER="neon"
$env:DATABASE_URL="<connection string branch test-arsip-ibu — JANGAN dicetak>"
# R2 (hanya jalur integrasi; nilai tidak pernah di-log)
$env:R2_ACCOUNT_ID="<...>"
$env:R2_ACCESS_KEY_ID="<...>"
$env:R2_SECRET_ACCESS_KEY="<...>"
$env:R2_BUCKET="vanka-universe-test"
$env:R2_KEY_PREFIX="test/"
# Aktifkan Opsi 2 HANYA di proses uji ini (butuh DB + R2 lengkap; fail-closed):
$env:MEDIA_STORAGE_DRIVER="db-r2"
```
`.env.local` tidak disentuh. Nilai secret tidak ditampilkan.

---

## 4. Uji integrasi (setelah wiring Opsi 2 disetujui)

Semua tulis HARUS di branch + bucket test.

1. **Upload** (`POST /api/media`, multipart + header `x-vanka-request: 1`): gambar
   dan video kecil. Verifikasi: `media_objects` bertambah 1 baris `ready`;
   objek R2 ada di `test/<uuid>.<ext>`; response 201 berisi record.
2. **List** (`GET /api/media`): record tampil; `pending` tidak pernah tampil.
3. **Proxy GET** (`GET /api/media/<id>`): byte identik; `Content-Type` benar.
4. **Range**: `Range: bytes=0-3` -> 206 + `Content-Range`; `bytes=999999-` -> 416.
5. **PATCH** (`PATCH /api/media/<id>`): ubah `title/description/takenAt`; GET
   ulang menampilkan nilai baru; `takenAt` invalid -> 422.
6. **DELETE**:
   - media tanpa referensi -> 200, baris + objek hilang;
   - media dipakai galeri -> **409 CONFLICT**, tidak ada yang dihapus;
   - saat tabel referensi tidak ada -> **409 REFERENCE_UNVERIFIED** (fail-closed).
7. **Migrasi belum jalan**: panggil media list/upload -> **503
   `MEDIA_STORE_NOT_MIGRATED`** (bukan 500 buram), berkat pemetaan error 4G.40D-3D0.
8. **E2E galeri**: `scripts/archive-gallery-e2e.mjs` (lihat `4G39D_MIGRATION_AND_E2E.md`)
   untuk memastikan referensi galeri terkait ke media.

---

## 5. Record `pending`, orphan, dan pemulihan

`pending` = baris metadata ada, upload belum terkonfirmasi. Tidak pernah tampil
ke user. Rencana rekonsiliasi: `src/lib/media/db/reconcile.ts` (belum di-wire,
tidak ada job otomatis).

Dua kasus:
- **objek tidak ada** -> baris metadata mati; hapus baris (aman) SETELAH probe
   `exists()` memastikan objek benar-benar tidak ada.
- **objek ada** -> promosikan ke `ready` (JANGAN hapus objek).

Aturan: **jangan pernah** menghapus objek berdasarkan dugaan; hanya baris
metadata yang dihapus, dan hanya setelah verifikasi ketiadaan.

Lihat baris `pending` (read-only):
```sql
select id, status, created_at, updated_at
  from public.media_objects where status='pending' order by created_at;
```

Jalankan rekonsiliasi (dry-run dulu, lalu apply) lewat pemanggilan terkontrol
dengan `pool`, `objects`, `maxAgeMs`, `dryRun`. Belum ada job otomatis.

Pemulihan manual satu baris:
```sql
-- object ADA, unggahan tak selesai -> promosikan
update public.media_objects set status='ready' where id='<uuid>' and status='pending';
-- object TIDAK ADA (sudah diverifikasi via HEAD/console) -> hapus metadata
delete from public.media_objects where id='<uuid>' and status='pending';
```
**Jangan** hapus objek R2 dari dugaan; verifikasi dulu.

---

## 5b. Skenario orphan / crash

Orphan yang mungkin muncul dari crash:
- crash sebelum PUT -> baris `pending` tanpa objek -> `delete-row`.
- crash setelah PUT sebelum `ready` -> baris `pending` + objek -> `mark-ready`.
- kompensasi gagal -> `pending` tersisa; NOT user-visible; reconcile manual.

Tidak ada job otomatis. Tidak ada akses R2 tanpa izin.

---

## 6. Rollback

- `4g40d3b` (DESTRUKTIF bila sudah ada metadata):
  ```sql
  BEGIN;
  DROP TABLE IF EXISTS public.media_objects;
  COMMIT;
  ```
  Hanya metadata DB. **Objek R2 tidak dihapus** (butuh tindakan terpisah + izin).
- `4g39`: lihat `db/4G39D_MIGRATION_AND_E2E.md` §3.
- Ambil Neon branch/snapshot sebelum perubahan apapun.

---

## 7. Rollback objek R2 (bila perlu)

Urutan aman: setelah tabel `media_objects` di-rollback, objek di bucket test
menjadi orphan. Hapus HANYA objek dengan prefix yang dipakai tes
(`test/`), HANYA setelah daftar objek diverifikasi terhadap baris DB yang tidak
ada. Jangan pakai URL publik/presigned. Butuh izin eksplisit.

---

## 8. Open approvals
1. Terapkan `4g39` + `4g40d3b` di branch `test-arsip-ibu`.
2. Sediakan kredensial R2 test (`vanka-universe-test`).
3. Setujui wiring driver Opsi 2 (perubahan kode).
4. Setujui E2E tulis di branch + bucket test.
