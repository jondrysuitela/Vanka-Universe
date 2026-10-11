# Rencana Skema & Draft Migrasi — Arsip Privat "Tentang Ibumu" (Tahap 4G.27)

> **Status dokumen: RENCANA. Belum ada yang diterapkan.** Tidak ada database (lokal/Neon),
> tidak ada SQL/migration dijalankan, tidak ada resource cloud. Aplikasi arsip **masih
> browser-only** (`localStorage`); tidak ada perilaku live yang diubah.
> Draft migrasi (BELUM dijalankan, BELUM diuji): `db/draft_migration_4g27_private_archive.sql`.

Legenda label: **[FAKTA]** terverifikasi dari kode/skema repo; **[KEPUTUSAN]** dipilih di tahap ini;
**[DITOLAK]** alternatif yang tidak dipakai; **[BELUM DIUJI]** belum diuji; **[PERLU IZIN]** butuh
persetujuan pemilik.

---

## 1. Kontrak saat ini [FAKTA]

Sumber: `src/lib/archive/draft.ts` + `/admin/archive` (`page.tsx`) + `/admin/archive/preview`.

| Field `PrivateArchiveDraft` | Tipe TS | Keterangan |
|---|---|---|
| `title` | `string` | judul arsip |
| `narrative` | `string` | narasi, paragraf dipisah baris kosong |
| `musicEnabled` | `boolean` | musik arsip aktif/tidak |
| `musicSrc` | `string` | **path/URL lokal** atau `""` — belum ada aset audio nyata |

- Kunci storage tunggal: `vanka.private-archive.draft.v1` (`ARCHIVE_DRAFT_KEY`).
- `coerceArchiveDraft` sudah **tidak pernah melempar** dan tidak menghapus data (baca toleran).
- UI menyatakan jujur: tidak ada PIN, tidak ada aset audio, tidak ada koleksi media, tidak ada
  persistensi server (`archive/page.tsx:14-22`). Preview murni browser, tidak membuka data server
  (`archive/preview/page.tsx:16-23`).
- Tidak ada endpoint API arsip. Tidak ada baris database.

## 2. Kecocokan tabel `media` untuk audio privat [FAKTA + temuan]

Media privat disimpan **filesystem** (`storage/media/index.json`), bukan tabel `media`
(`db/PRIVATE_MEDIA_STORAGE_PLAN.md` §1). Tabel `media` di `db/schema.sql` belum dipakai kode.

Temuan yang membatasi representasi audio:

- **`media.media_type` CHECK hanya `('photo','video')`** → **tidak bisa** menyimpan baris audio
  tanpa memperlebar CHECK. Ini prasyarat konkret (lihat §5).
- `media.memory_id UUID REFERENCES memories(id)` **nullable** → baris media tanpa kenangan sah.
- `media.privacy` CHECK `private|shared|public`; `storage_provider` CHECK `r2|s3|gcs`;
  `file_size BIGINT`, `mime_type`, `duration_seconds INT` → cukup untuk metadata audio.
- **Tidak ada kolom `name`** di `media`, sedangkan `MediaRecord.name` ada (`store.ts:46-60`).
- **Mismatch domain**: `MediaRecord.kind` = `image|video` (`store.ts:44`) vs
  `media.media_type` = `photo|video` (`schema.sql:44,58`). `photo` ≠ `image` → perlu peta saat
  metadata pindah ke DB. Dicatat, tidak diubah di tahap ini.

## 3. Kepemilikan tabel & privacy [KEPUTUSAN]

**[KEPUTUSAN] Tabel khusus `private_archives`.** Arsip privat adalah entitas tersendiri, bukan
`content`/`birthday_editions` (jangan duplikasi model itu).

Kolom:

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | default `uuid_generate_v4()` |
| `slug` | VARCHAR(255) NOT NULL **UNIQUE** | identitas stabil + kunci impor deterministik (mis. `tentang-ibumu`) |
| `title` | VARCHAR(255) NOT NULL DEFAULT '' | |
| `narrative` | TEXT NOT NULL DEFAULT '' | |
| `music_enabled` | BOOLEAN NOT NULL DEFAULT false | dari `musicEnabled` |
| `music_media_id` | UUID → `media(id)` ON DELETE RESTRICT | audio privat (nullable); **bukan** URL/path |
| `status` | VARCHAR(50) NOT NULL DEFAULT 'draft' | CHECK `draft\|archived` |
| `created_by` | UUID → `admins(id)` ON DELETE SET NULL | |
| `created_at`/`updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | trigger `updated_at` |

Index: `status`, `music_media_id` (FK tidak otomatis terindeks). `slug` UNIQUE sudah terindeks.

**Tidak ada kolom `privacy`** — arsip ini *selalu* privat; flag per-baris justru berisiko salah
konfigurasi. Otorisasi ditegakkan server-side (§5). `musicSrc` **tidak** disimpan.

**Status `draft|archived` saja**: arsip privat tidak pernah dipublikasikan publik (lihat §8 untuk
keputusan produk yang masih terbuka: "published"/"visible"). Tidak ada `scheduled_at`.

**[DITOLAK]**
- Perluas `content`/`birthday_editions`: mencampur semantik publik & privat; duplikasi model.
- Kolom `privacy`: arsip selalu privat → flag redundan/berbahaya.
- Simpan `musicSrc` sebagai TEXT URL/path: melanggar aturan media privat (public URL exposure).
- Tabel anak `private_archive_media` (koleksi foto): **belum ada kontrak produk/ UI** (preview
  menampilkan empty state jujur) → tidak dibuat (jangan mengarang).
- Status `published`/`scheduled`: tidak ada UI/publikasi; jangan menyemai kolom spekulatif.

## 4. Hubungan dengan edisi ulang tahun [KEPUTUSAN]

**Tidak ada FK ke `birthday_editions`/`birthday_letters`.** Kontrak produk tidak menghubungkan
arsip privat dengan edisi ulang tahun (arsip "Tentang Ibumu" terpisah dari arsip ulang tahun
publik). Menambah FK akan mengarang relasi yang tidak ada. (Draft `birthday_letters` 4G.26 =
SQL **belum dieksekusi**, bukan tabel live; tidak direferensikan.)

## 5. Referensi audio privat & akses [KEPUTUSAN]

- Audio privat **hanya** lewat `music_media_id → media(id)`. Tidak ada URL/path mentah.
- Prasyarat: `media.media_type` diperlebar **aditif** ke `('photo','video','audio')` (§0a draft).
  Hanya memperlebar CHECK; tidak menyentuh data/baris media.
- **Baris DB TIDAK membuat file privat.** Akses file tetap lewat `/api/media/[id]` yang memerlukan
  sesi valid + role `owner|admin` (`src/lib/media/policy.ts`), `Cache-Control: private`. Rencana
  R2/proxy ada di `db/PRIVATE_MEDIA_STORAGE_PLAN.md`; kredensial/URL tidak boleh bocor.
- Penegakan lintas-tabel (`music_media_id` harus menunjuk `media` bertipe `audio` + `privacy='private'`)
  **tidak** bisa di-CHECK PostgreSQL → wajib di lapisan aplikasi (validasi saat menulis).
- `media.memory_id` tetap NULL untuk audio arsip (bukan kenangan).
- Delete media: FK RESTRICT + reference-check fail-closed (`src/lib/media/references.ts`) →
  media yang direferensikan arsip tidak bisa dihapus diam-diam.

## 6. Urutan migrasi & cakupan preflight [KEPUTUSAN]

Urutan (tidak ada FK antar-draft; urutan demi kejelasan prasyarat):
1. `db/schema.sql` → 2. `db/init.sql` → 3. draft auth `4c2a` → 4. draft surat `4g26` →
5. **`db/draft_migration_4g27_private_archive.sql`**.

Tidak ada konflik semantik dengan draft auth/surat: berkas ini **tidak** mengubah keduanya
(auth/surat tidak menyentuh `media`/`private_archives`). Satu-satunya perubahan pada skema dasar
adalah pelebaran CHECK `media.chk_media_type` (§0a), **aditif & didokumentasikan**.

Cakupan preflight draft:
- Prasyarat: extension `uuid-ossp`, tabel `admins`, fungsi `update_updated_at_column`.
- (§0a) `media` ada; `media.chk_media_type` ada; perluas aditif bila belum memuat `audio`.
- (§0b) `media.media_type` mengizinkan `audio`.
- Bila `private_archives` sudah ada: kolom wajib lengkap, `music_media_id` bertipe `uuid`,
  `status` default `draft`, `slug` UNIQUE, FK ke `media` dan `admins` ada.
- Pelanggaran → `RAISE EXCEPTION` → rollback penuh, tanpa DDL diterapkan.

## 7. Verifikasi pasca-migrasi & batas rollback [RENCANA — belum dijalankan]

```sql
-- Kolom + tipe + default
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='private_archives'
 ORDER BY ordinal_position;

-- Constraint (status domain, UNIQUE slug, FK media/admins)
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid='public.private_archives'::regclass ORDER BY conname;

-- Index
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename='private_archives';

-- Trigger updated_at
SELECT tgname FROM pg_trigger
 WHERE tgrelid='public.private_archives'::regclass AND NOT tgisinternal;

-- Perluasan CHECK media
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='public.media'::regclass AND conname='chk_media_type';

-- Tidak ada seed: 0 baris tepat setelah migrasi
SELECT count(*) FROM private_archives;
```

Batasan rollback (DESTRUKTIF / SATU ARAH, `[PERLU IZIN]`):

```sql
BEGIN;
DROP TABLE IF EXISTS private_archives;                       -- kehilangan konten arsip yang diimpor
ALTER TABLE media DROP CONSTRAINT IF EXISTS chk_media_type;  -- kembalikan pembatasan audio
ALTER TABLE media ADD CONSTRAINT chk_media_type CHECK (media_type IN ('photo','video'));
COMMIT;
```
- Mengembalikan CHECK media akan **gagal** bila sudah ada baris `media_type='audio'` → jangan
  dipaksa; itu sinyal ada dependensi.
- Sebelum impor, rollback tidak menghilangkan data eksternal (migrasi tidak menyemai).
- Tidak ada tabel versi → re-run parsial tidak terdeteksi otomatis.

## 8. Keputusan produk yang MASIH TERBUKA

- **Status "published"/"visible"** untuk arsip privat: apakah perlu status selain `draft|archived`?
  Perlu keputusan pemilik sebelum menambah nilai/kolom.
- **Koleksi media arsip** (foto/video selain musik): belum ada kontrak/ UI → tidak dimodelkan.
- **Nilai `slug`**: usulan `tentang-ibumu` (mengikuti judul UI). Perlu konfirmasi sebagai identitas
  tetap.
- **Mode akses file audio** (proxy terautentikasi vs presigned): lihat
  `db/PRIVATE_MEDIA_STORAGE_PLAN.md` §3.4 — belum diputuskan.

## 9. Yang SENGAJA tidak dilakukan [FAKTA]

- Tidak membuat adapter DB palsu; tidak mengalihkan arsip live ke database.
- Tidak membuat kolom/tabel NYATA: hanya DRAFT SQL yang belum dijalankan.
- Tidak menyemai konten/admin; tidak mempublikasikan / mengekspos konten/media privat.
- Tidak mengubah perilaku live arsip, media, auth, atau ulang tahun.

## 10. Verifikasi tes [FAKTA]

- Draft diperiksa statis oleh `src/lib/db/__tests__/private-archive-migration.test.ts`
  (teks SQL, tanpa DB): penanda DRAFT/BELUM DIJALANKAN, preflight, kolom & FK, default `draft`,
  UNIQUE `slug`, pelebaran media aditif, tanpa `privacy`/`musicSrc`/seed, satu transaksi.
- Uji ini **tidak** membuktikan SQL valid di server; itu **[BELUM DIUJI]** karena belum ada DB.

Lihat juga: `db/SCHEMA.md`, `db/BIRTHDAY_PERSISTENCE_PLAN.md`, `db/PRIVATE_MEDIA_STORAGE_PLAN.md`,
`db/draft_migration_4g26_birthday_letters.sql`.
