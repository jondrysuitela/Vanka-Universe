# Rencana Persistensi Ulang Tahun — Surat, Edisi, Arsip Privat (Tahap 4G.25 & 4G.26)

> **Status dokumen: RENCANA. Belum ada yang diterapkan.** Tidak ada database (lokal/Neon),
> tidak ada migration dijalankan, tidak ada resource cloud. Aplikasi **masih memakai
> `localStorage`**; pengalaman ulang tahun yang berjalan **tidak** dialihkan ke database.
> Dokumen ini menjelaskan kontrak data, pemetaan ke tabel, celah yang belum didukung skema, dan
> rencana impor non-destruktif.
>
> **4G.26 — keputusan skema:** surat ulang tahun disimpan di tabel **khusus `birthday_letters`**
> (bukan `content`), dengan `full_text` kanonik + `sections`/`thumbnail` sebagai **JSONB**. Draft
> migrasi (BELUM dijalankan, BELUM diuji) ada di
> `db/draft_migration_4g26_birthday_letters.sql`. Lihat §4 dan §10.

Legenda label: **[FAKTA]** terverifikasi dari kode/skema repo; **[RENCANA]** belum dijalankan;
**[BELUM DIUJI]** belum diuji; **[PERLU IZIN]** butuh persetujuan pemilik (DB/skema/rahasia).

---

## 1. Penyimpanan saat ini [FAKTA]

Semua konten ulang tahun yang dapat diedit hari ini hidup **hanya di browser** (localStorage).
Tidak ada endpoint API untuk surat/edisi/arsip; tidak ada baris database.

| Kunci localStorage | Isi | Penulis | Pembaca |
|---|---|---|---|
| `vanka.letters.v2` | `Record<age, LetterDraft>` (usia `"1"`–`"17"`) | `src/components/birthday/LetterScene.tsx` (`saveLetterForAge`) | editor `/admin/birthday`, pratinjau `/birthday-experience?preview=1&letter=1&age=N` |
| `vanka.letter.draft.v1` | satu `LetterDraft` lama (fallback usia 1) | `LetterScene.tsx` (`saveLetterDraft`) | `loadLetterForAge(1)` |
| `vanka.private-archive.draft.v1` | `PrivateArchiveDraft` (title, narrative, musicEnabled, musicSrc) | `src/lib/archive/draft.ts` | `/admin/archive`, `/admin/archive/preview` |

`LetterDraft` = `{ title: string; date: string; fullText: string; sections: LetterSection[]; thumbnail?: LetterThumbnail }`
(`src/components/birthday/LetterScene.tsx:43-51`). `LetterSection` = `{ id, heading, body }` (`:23-28`).
`LetterThumbnail` = `{ src?, alt, caption? }` (`:36-41`). `PrivateArchiveDraft` lihat
`src/lib/archive/draft.ts:12-21`.

## 2. Katalog tema [FAKTA]

`src/lib/birthday/theme-registry.ts` adalah katalog **statis di kode**: 17 entri usia 1–17,
masing-masing dengan `id` stabil (`vanka-birthday-NN`), `slug`, `age`, `year`
(= `BIRTH_DATE.year + age`, usia 1 → 2026), `title`, `subtitle`, `palette`, `concept`, dan
`readiness` (`implemented` hanya usia 1). **Tidak ada tabel tema/edisi** yang menyimpannya.
Registri ini murni metadata dan sengaja tidak menyimpan konten surat/media.

## 3. Tabel yang tersedia sekarang [FAKTA — `db/schema.sql`]

Kedua tabel ini **ada di skema tetapi belum dipakai kode ulang tahun mana pun** (grep: tidak ada
`FROM birthday_editions` / `FROM content`).

`birthday_editions`:

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | default `uuid_generate_v4()` |
| `year` | INT NOT NULL **UNIQUE** | tahun perayaan |
| `title` | VARCHAR(255) NOT NULL | |
| `subtitle` | VARCHAR(255) | |
| `narrative` | TEXT | |
| `cover_media_id` | UUID → media(id) ON DELETE RESTRICT | FK media, **bukan** path string |
| `status` | VARCHAR(50) default `'draft'` | CHECK: `draft\|scheduled\|published\|archived` |
| `scheduled_at` / `published_at` | TIMESTAMPTZ | CHECK: status terkait wajib terisi |
| `privacy` | VARCHAR(50) default `'private'` | CHECK: `private\|shared\|public` |
| `created_by` | UUID → admins(id) ON DELETE SET NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL default now() | |

`content`:

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | |
| `type` | VARCHAR(50) NOT NULL | CHECK: `narrative\|letter\|caption\|page` |
| `title` | VARCHAR(255) NOT NULL | |
| `slug` | VARCHAR(255) **UNIQUE** | boleh NULL |
| `body` | TEXT | |
| `status` | VARCHAR(50) default `'draft'` | CHECK: `draft\|review\|scheduled\|published\|archived` |
| `privacy` | VARCHAR(50) default `'private'` | CHECK: `private\|shared\|public` |
| `scheduled_at` / `published_at` | TIMESTAMPTZ | CHECK status terkait |
| `created_by`, `created_at`, `updated_at` | | |

## 4. Kepemilikan tabel & kontrak pemetaan [KEPUTUSAN 4G.26]

**Keputusan: tabel khusus `birthday_letters`** (bukan `content`). Alternatif yang ditolak dan
alasannya ada di §10. Kontrak pemetaan:

| Field draft | Sumber (localStorage) | Kolom tujuan | Catatan |
|---|---|---|---|
| edisi `year` | diturunkan dari `age` (`birthYear + age`) | `birthday_editions.year` (UNIQUE) | kunci edisi deterministik |
| hubungan surat→edisi | identitas usia | `birthday_letters.edition_id` (UNIQUE, FK) | 1 surat per edisi |
| `title` (surat) | `LetterDraft.title` | `birthday_letters.title` | `NOT NULL DEFAULT ''` |
| `fullText` | `LetterDraft.fullText` | `birthday_letters.full_text` (**kanonik**) | `NOT NULL DEFAULT ''` |
| `date` (tampil) | `LetterDraft.date` | `birthday_letters.display_date` | VARCHAR, **bukan** DATE |
| `sections` | `LetterDraft.sections` | `birthday_letters.sections` **JSONB** | array `LetterSection[]` |
| `thumbnail` | `LetterDraft.thumbnail` | `birthday_letters.thumbnail` **JSONB** | objek atau NULL |
| status | (selalu baru) | `birthday_letters.status` default `'draft'` | lihat §5 |
| identitas tema | registri statis | **tetap di kode** | GAP-4 |
| arsip `title`/`narrative` | `PrivateArchiveDraft` | `content` (`type='narrative'`) | belum dimigrasikan |
| arsip `musicEnabled`/`musicSrc` | idem | **tidak ada kolom** | GAP-5; lihat §11 |

**TIDAK ada kolom `slug` di `birthday_letters`.** Kunci impor = `birthday_editions.year` (UNIQUE)
→ `birthday_letters.edition_id` (UNIQUE). Helper
`src/lib/birthday/persistence.ts:letterEditionIdentity()` tetap menghasilkan `letterSlug`
(`birthday-letter-<year>`) sebagai **kunci rekonsiliasi sisi klien**; server memetakannya ke
`year`/`edition_id` dan **tidak** menyimpannya sebagai kolom (mencegah index UNIQUE duplikat).
Impor idempoten: `ON CONFLICT (year) DO NOTHING` (edisi) dan `ON CONFLICT (edition_id) DO NOTHING`
(surat) → **tidak pernah menimpa** baris yang sudah ada.

## 5. Siklus status: UI vs skema [FAKTA + RENCANA]

| Status | Didukung UI hari ini? | Didukung skema? |
|---|---|---|
| draf lokal (browser) | **ya** (editor + Simpan Draf Lokal) | `birthday_letters.status='draft'` (default) / `birthday_editions.status='draft'` |
| pratinjau admin | **ya** (`?preview=1`) — render lokal, bukan publikasi | tidak ada status khusus; ini hanya baca |
| published / scheduled / archived | **tidak ada UI sama sekali** | kolom ada, **tidak ada kode** yang menulisnya |

Karena itu pratinjau **tidak** berarti "publish". Impor awal harus mendarat sebagai `draft`.

## 6. Kepemilikan & otorisasi [RENCANA]

- Surat dan arsip privat adalah **konten privat**. Semua endpoint masa depan (jika dibuat) WAJIB
  memerlukan session admin valid + peran `owner`/`admin`; **tidak pernah** publik, terlepas dari
  nilai `privacy`. Ini mengikuti kontrak Memories yang sudah ada (`src/lib/memories/policy.ts`) dan
  media (`src/lib/media/policy.ts`). Belum ada endpoint yang dibuat di tahap ini.
- Arsip "Tentang Ibumu" lebih sensitif: pratinjau saat ini murni browser dan **tidak** membuka
  data server (`src/app/admin/(protected)/archive/preview/page.tsx:16-23`).
- `thumbnail.src` HANYA boleh path publik nyata (mis. di `public/`). Media privat dari
  `/api/media` **tidak boleh** direferensikan (lihat `LetterScene.tsx:30-35`).

## 7. Tanggal, timestamp, keunikan [FAKTA + catatan]

- `LetterDraft.date` adalah **string tampilan** (mis. `"27 Oktober 2026"`), BUKAN tanggal DB.
  Tidak boleh dipetakan buta ke kolom `DATE`/`TIMESTAMPTZ`.
- `birthday_editions.year` UNIQUE dan `birthday_letters.edition_id` UNIQUE; keduanya jadi kunci
  impor (tanpa kolom `slug` di `birthday_letters`).
- `created_at`/`updated_at` DB diisi `now()`. localStorage **tidak** menyimpan waktu pembuatan,
  jadi waktu impor ≠ waktu penulisan asli; jangan mengklaim sebaliknya.
- Kolom DATE di skema lain (`memories.memory_date`, `media.taken_date`) tidak relevan di sini.

## 8. Kompatibilitas `vanka.letters.v2` [FAKTA]

- Struktur `vanka.letters.v2` = objek berkunci usia (`"1"`..`"17"`), tiap nilai sebuah
  `LetterDraft`. Kunci usia menentukan identitas edisi → **aman** dipetakan deterministik.
- Kunci lama `vanka.letter.draft.v1` hanya fallback usia 1; impor harus memperlakukan keduanya
  (utamakan `vanka.letters.v2["1"]`, jika tidak ada baru fallback ke kunci lama).
- Pembacaan saat ini **toleran**: JSON rusak → `{}` (`loadLetterStore`), entri bertipe salah
  → dibuang dari hasil baca **tanpa menghapus** data tersimpan. Tidak ada auto-recovery destruktif
  dari sisi baca. **Risiko [FAKTA]:** `saveLetterForAge`/`deleteLetterForAge` memanggil
  `loadLetterStore()` lalu menulis ulang seluruh blob — bila blob rusak, simpan berikutnya
  **menimpa** blob rusak itu (data rusak memang sudah tidak terbaca, tetapi tidak ada cadangan).

## 9. Rencana impor non-destruktif [RENCANA]

Belum dijalankan. Urutan yang disarankan (semua butuh izin untuk bagian DB):

1. **Backup dulu** [PERLU IZIN]: ekspor mentah nilai `localStorage` (`vanka.letters.v2`,
   `vanka.letter.draft.v1`, `vanka.private-archive.draft.v1`) ke berkas. Jangan mulai menulis
   server sebelum ini ada.
2. **Rencanakan di sisi klien** (murni, tersedia sekarang):
   `planLetterImport(rawStore)` di `src/lib/birthday/persistence.ts` memisahkan `entries`
   (valid), `invalid` (rusak, disertai pesan error), dan `outOfRange`. **Tidak** memperbaiki,
   **tidak** menghapus, **tidak** menulis.
3. **Tinjau manual** entri `invalid`/`outOfRange`; jangan pernah membuang diam-diam.
4. **Peta ke payload kanonik** via `toLetterPayload()` (field order stabil).
5. **Tulis ke server** [PERLU IZIN; migrasi 4G.26 belum dijalankan]: impor edisi dulu
   (`birthday_editions.year`, `ON CONFLICT (year) DO NOTHING`), lalu surat
   (`birthday_letters.edition_id`, `ON CONFLICT (edition_id) DO NOTHING`); mulai sebagai `draft`;
   **jangan** menimpa baris yang sudah ada tanpa keputusan eksplisit pengguna.
6. **Verifikasi** jumlah/judul cocok, lalu **baru** pertimbangkan menghapus kunci lokal — dan hanya
   dengan persetujuan; penghapusan tidak pernah otomatis.
7. Selama proses, konten privat **tidak** dipublikasikan dan tidak ada media privat yang diekspos.

## 10. Keputusan skema, alternatif ditolak, dan celah tersisa [KEPUTUSAN 4G.26]

### Keputusan: tabel khusus `birthday_letters`

- 1 surat per edisi ditegakkan `UNIQUE (edition_id)` + FK `ON DELETE RESTRICT` (hapus edisi tidak
  bisa diam-diam menghancurkan surat).
- `full_text` kanonik (`NOT NULL DEFAULT ''`).
- `sections JSONB NOT NULL DEFAULT '[]'` + CHECK `jsonb_typeof(sections) = 'array'`.
- `thumbnail JSONB` (NULL diizinkan) + CHECK `jsonb_typeof(thumbnail) = 'object'`.
- `display_date VARCHAR(255)` (presentational, **bukan** DATE).
- `status` default `'draft'`, domain sama dengan `content`
  (`draft|review|scheduled|published|archived`) + CHECK konsistensi `scheduled`/`published`.
- Index tambahan: `status`, `created_at`. **Tidak** ada index pada `edition_id` (UNIQUE sudah
  membuatnya). Draft: `db/draft_migration_4g26_birthday_letters.sql` (BELUM dijalankan).

**Alternatif yang DITOLAK:**
- **Tolak: perluas `content`** (`type='letter'` + `birthday_edition_id`/`sections`/`thumbnail`).
  Alasan: `content` generik (narrative/caption/page); menambah FK edisi + JSONB khusus-ulang-tahun
  membuat kolom yang hanya bermakna untuk satu `type`, dan `content.slug` global UNIQUE menciptakan
  sistem identitas kedua yang tumpang tindih dengan `birthday_editions.year`.
- **Tolak: tabel anak `birthday_letter_sections`** (position/heading/body). Alasan: tabel + join
  ekstra; JSONB array sudah menjaga urutan dan cocok persis dengan tipe TS `LetterSection[]`.
- **Tolak: simpan `fullText` saja lalu bangkitkan ulang scene** via `splitIntoScenes`. Alasan:
  editor mengizinkan edit/urut-ulang scene manual → hasil edit hilang pada round-trip server.
- **Tolak: kolom `slug` di `birthday_letters`.** Alasan: duplikat index UNIQUE di atas
  `edition_id`; `letterSlug` cukup sebagai kunci rekonsiliasi sisi klien.
- **Tolak: petakan `date` ke tipe `DATE`.** Alasan: belum ada kontrak tanggal kanonik; string
  tampilan Indonesia tidak boleh di-cast buta.

### Celah yang BELUM diselesaikan

- **GAP-4 identitas tema**: `id`/`slug`/`palette`/`concept` tetap di kode (metadata stabil).
- **GAP-5 musik arsip**: `musicEnabled`/`musicSrc` tidak punya kolom; belum ada aset audio nyata.
- **GAP-6 status/otorisasi**: belum ada endpoint, policy, atau UI publish untuk surat/edisi/arsip.
- **GAP-7 riwayat/versi**: tidak ada tabel versi; impor ulang terdeteksi hanya lewat UNIQUE
  `year`/`edition_id`.
- **GAP-8 arsip privat belum punya skema**: title/narrative cocok `content`, tetapi belum ada
  migrasi; arsip tetap browser-only.

## 11. Kontrak referensi media privat (masa depan) [RENCANA]

Keputusan 4G.26 #5: **JANGAN** menyimpan `musicSrc` atau URL media privat apa pun sebagai string
yang bisa diakses publik.

- Media privat direferensikan **hanya** lewat `media.id` (UUID FK) — bukan URL. `media.storage_key`
  tetap server-side; bucket privat; akses lewat proxy ber-aotorisasi (lihat
  `db/PRIVATE_MEDIA_STORAGE_PLAN.md`).
- `birthday_letters.thumbnail` HANYA boleh berisi path **publik** nyata (mis. berkas di `public/`).
  Ia TIDAK boleh menunjuk `/api/media` atau URL privat. Bila kelak thumbnail harus privat, gunakan
  `media.id` (perubahan skema terpisah), bukan string URL.
- `PrivateArchiveDraft.musicSrc` saat ini adalah string lokal; impor masa depan **tidak** boleh
  memetakannya ke kolom URL publik. Skema arsip privat (termasuk referensi audio via `media.id`)
  belum dibuat — butuh keputusan + migrasi terpisah.
- Belum ada endpoint media privat publik; tidak ada yang diekspos di tahap ini.

## 12. Yang SENGAJA tidak dilakukan [FAKTA]

- Tidak membuat adapter database palsu.
- Tidak mengalihkan pengalaman ulang tahun (atau arsip) yang sedang berjalan ke database.
- Tidak membuat kolom/tabel NYATA: hanya DRAFT SQL (`db/draft_migration_4g26_birthday_letters.sql`)
  yang **belum dijalankan** dan belum diuji terhadap PostgreSQL.
- Tidak membuat kenangan ulang tahun atau foto placeholder palsu.
- Tidak menyentuh media privat atau mempublikasikan konten privat.

## 13. Verifikasi

- `src/lib/birthday/persistence.ts` diuji oleh
  `src/lib/birthday/__tests__/persistence.test.ts` (murni, tanpa DB/DOM): identitas deterministik,
  validasi tanpa perbaikan, payload stabil, dan impor non-destruktif (input tidak berubah).
- Draft migrasi diperiksa statis oleh `src/lib/db/__tests__/birthday-migration.test.ts` (teks SQL,
  tanpa DB): penanda DRAFT/BELUM DIJALANKAN, preflight, kolom & JSONB checks, default `draft`,
  UNIQUE+FK `edition_id`, tanpa seed/publish, tanpa `musicSrc`, dibungkus satu transaksi.
- Uji-uji ini **tidak** membuktikan SQL valid di server; itu **[BELUM DIUJI]** karena belum ada DB.

Lihat juga: `db/SCHEMA.md`, `db/NEON_IMPLEMENTATION_PLAN.md`, `db/MIGRATION_CHECKLIST.md`,
`db/draft_migration_4g26_birthday_letters.sql`, `db/PRIVATE_MEDIA_STORAGE_PLAN.md`.

## 14. Verifikasi pasca-migrasi & batas rollback [RENCANA — belum dijalankan]

Query verifikasi (dijalankan manual di psql **hanya setelah** migrasi diterapkan; belum pernah):

```sql
-- Kolom + tipe + nullability + default
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'birthday_letters'
 ORDER BY ordinal_position;

-- Constraint (status domain, JSONB checks, UNIQUE, FK)
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.birthday_letters'::regclass
 ORDER BY conname;

-- Index (edition_id UNIQUE + status + created_at)
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'birthday_letters';

-- Trigger updated_at
SELECT tgname FROM pg_trigger
 WHERE tgrelid = 'public.birthday_letters'::regclass AND NOT tgisinternal;

-- Tidak ada seed: harus 0 baris tepat setelah migrasi
SELECT count(*) FROM birthday_letters;
```

Batas rollback:

```sql
-- DESTRUKTIF / SATU ARAH. Menghapus tabel + semua surat yang sudah diimpor.
-- JANGAN jalankan tanpa [PERLU IZIN].
BEGIN;
DROP TABLE IF EXISTS birthday_letters;
COMMIT;
```

- Trigger `trg_birthday_letters_updated_at` ikut terhapus bersama tabel.
- Sebelum ada impor, rollback tidak menghilangkan data eksternal apa pun (migrasi tidak menyemai).
- Setelah impor, rollback **kehilangan** surat tersebut; `localStorage` tetap ada sebagai sumber.
- Tidak ada tabel versi → re-run parsial tidak terdeteksi otomatis.
