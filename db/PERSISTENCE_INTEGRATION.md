# Server Persistence Integration — Birthday Letters & Private Archive (Tahap 4G.30)

> **Status: kode lapisan server DIIMPLEMENTASI; BELUM terhubung ke UI; database BELUM dikonfigurasi.**
> Tidak ada database (lokal/Neon) dibuat/diakses, tidak ada migration dijalankan, tidak ada `.env`
> diubah. UI live **masih** memakai `localStorage`. Dokumen ini mencatat apa yang ada, di mana titik
> integrasinya nanti, dan blocker yang tersisa.

---

## 1. Yang ditambahkan (fakta)

**Birthday letters** (`birthday_letters`, draft migrasi 4G.26 — belum dijalankan):
- `src/lib/birthday/letters/schema.ts` — validasi Zod (`strictObject`), `parseLetterAge`.
- `src/lib/birthday/letters/policy.ts` — `BIRTHDAY_LETTER_ROLES = ["owner","admin"]`.
- `src/lib/birthday/letters/repository.ts` — SQL tervalidasi parameter.
- `src/app/api/birthday/letters/route.ts` — `GET` (daftar), `POST` (buat/perbarui **draf**).
- `src/app/api/birthday/letters/[age]/route.ts` — `GET` satu surat per usia (1–17).

**Birthday editions** (`birthday_editions`, tabel dasar `db/schema.sql`):
- `src/lib/birthday/editions/schema.ts` — validasi Zod (`strictObject`, hanya `age`).
- `src/lib/birthday/editions/policy.ts` — `BIRTHDAY_EDITION_ROLES = ["owner","admin"]`.
- `src/lib/birthday/editions/repository.ts` — SQL tervalidasi parameter.
- `src/app/api/birthday/editions/route.ts` — `POST` buat **draf** edisi (operator-only).

**Private archive** (`private_archives`, draft migrasi 4G.27 — belum dijalankan):
- `src/lib/archive/schema.ts` — validasi Zod; `PRIVATE_ARCHIVE_SLUG = "tentang-ibumu"`.
- `src/lib/archive/policy.ts` — `PRIVATE_ARCHIVE_ROLES = ["owner","admin"]`.
- `src/lib/archive/media-link.ts` — `validatePrivateAudioReference` (fail-closed).
- `src/lib/archive/repository.ts` — SQL tervalidasi parameter.
- `src/app/api/archive/route.ts` — `GET`, `PUT`.

Semua endpoint: butuh sesi admin (`requireSession`) **dan** role operator (`requireRole`); mutasi
memakai `assertSafeMutation` (Origin + `application/json` + `x-vanka-request: 1`). Tidak ada rute
privat yang publik.

## 2. Aturan yang ditegakkan (fakta)

- **Draft-only.** `status` tidak pernah berasal dari klien (`strictObject` menolak `status`); repository
  menulis literal `'draft'`. `POST` surat memakai `ON CONFLICT (edition_id) ... WHERE status = 'draft'`
  → surat yang bukan draf **tidak** bisa ditimpa (409 `LETTER_LOCKED`). Arsip: `status` tidak pernah
  di-`UPDATE`.
- **Edition association.** Server memetakan `age` → tahun (registri statis) lalu mencari
  `birthday_editions.id` lewat `year` (UNIQUE). Edisi dibuat lewat `POST /api/birthday/editions`
  (operator-only, draf-only, `status='draft'`/`privacy='private'` hardcoded, `ON CONFLICT (year) DO
  NOTHING` → tak menimpa/menduplikasi). `POST` surat **tidak** membuat edisi: bila edisi belum ada,
  ia mengembalikan 409 `EDITION_NOT_FOUND`.
- **Audio privat.** `musicSrc` (path/URL) ditolak schema. `music_media_id` non-null **ditolak** 422
  `AUDIO_NOT_SUPPORTED`: belum ada jalur media bertipe `audio` yang bisa diverifikasi (store runtime
  hanya `image`/`video`; CHECK `media.media_type` belum memuat `audio`).
- Arsip **selalu privat** — tanpa kolom/flag `privacy`, tanpa rute publik.

## 3. Gap yang harus diputuskan (blocker, belum diselesaikan)

- **Edisi harus dibuat lebih dulu.** Operasi tulis surat (`POST /api/birthday/letters`) akan 409
  `EDITION_NOT_FOUND` sampai baris edisi ada. Alur sah: panggil `POST /api/birthday/editions`
  (`{ age }`) lebih dulu. Endpoint ini **tidak** mempublikasikan edisi (`status='draft'`).
- **Tidak ada jalur unggah audio.** `music_media_id` tetap `NULL` sampai ada jenis `media` `audio`
  (migrasi 4G.27) + unggahan ber-otorisasi.
- Pemetaan metadata media ke tabel `media` (mis. `MediaRecord.kind image|video` vs `media_type
  photo|video`) belum diselesaikan (ditemukan di 4G.27).

## 4. Integrasi UI Tulis Surat & Arsip (Tahap 4G.32 / 4G.33)

`src/app/admin/(protected)/birthday/page.tsx` memakai `src/lib/birthday/letter-sync.ts`;
`src/app/admin/(protected)/archive/page.tsx` memakai `src/lib/archive/archive-sync.ts`. Keduanya
modul murni (fetch disuntik, tanpa storage/render):

- **Muat (read-only):** `GET /api/birthday/letters` / `GET /api/archive` sekali saat halaman dibuka.
  Gagal (5xx/network) → status `unavailable`; tidak pernah dianggap "tidak ada data".
- **Simpan eksplisit:** tombol "Simpan ke Server" → `POST /api/birthday/letters` (surat, dengan
  `POST /api/birthday/editions` bila `EDITION_NOT_FOUND`) / `PUT /api/archive` (arsip). Tidak ada
  burst write saat page load.
- **Draf lokal aman:** modul tidak pernah menyentuh `localStorage`; simpan server tidak menghapus/
  menimpa draf lokal; gagal simpan **tidak** fallback diam-diam.
- **Rekonsiliasi non-destruktif:** bila draf lokal dan versi server berbeda, UI menandai "beda"/
  "perlu kirim"/"server" + aksi sadar "Muat Versi Server ke Editor" / "Kirim Draf Lokal ke Server".
  Tidak ada pilihan otomatis.
- Pesan sukses hanya saat server mengonfirmasi (`status: "saved"`).
- **Arsip privat:** selalu privat (tanpa `privacy`, tanpa rute publik); `musicSrc` (path/URL) ditolak
  schema; `musicMediaId` tetap `null` (audio belum didukung → 422 `AUDIO_NOT_SUPPORTED` dijelaskan,
  bukan dipalsukan). **Preview arsip** (`/admin/archive/preview`) membaca **hanya** draf `localStorage`
  — tidak ada rute publik, tidak ada bypass PIN, tidak ada media privat dibuka tanpa otorisasi.

| Halaman | Berkas | Sumber data saat ini | Status |
|---|---|---|---|
| Tulis Surat | `src/app/admin/(protected)/birthday/page.tsx` | draf lokal `LetterScene` + API server (eksplisit) | terintegrasi (4G.32) |
| Arsip Privat | `src/app/admin/(protected)/archive/page.tsx` | draf lokal `@/lib/archive/draft.ts` + API `GET/PUT /api/archive` (eksplisit) | terintegrasi (4G.33) |
| Preview arsip | `src/app/admin/(protected)/archive/preview/page.tsx` | draf `localStorage` saja | tetap lokal (privat, tanpa rute publik) |

Catatan: belum ada `GET /api/birthday/editions`, jadi daftar edisi server tidak dimuat terpisah; edisi
diselesaikan secara lazy saat simpan.

## 5. Blockers verifikasi Neon / login nyata

1. Tidak ada database (lokal/Neon) dan tidak ada `DATABASE_URL`/`DB_DRIVER` (`.env` belum dibuat).
2. Draft migrasi `4c2a`/`4g26`/`4g27` **belum dijalankan** → tabel `sessions`, `admins.password_hash`,
   `birthday_letters`, `private_archives` belum ada.
3. Belum ada akun owner (`scripts/create-owner.mjs` belum dijalankan) → tidak ada `password_hash`.
4. Karena itu login end-to-end, validasi sesi nyata, dan persistensi surat/arsip **belum** dapat diuji.

Langkah verifikasi nyata (butuh `[PERLU IZIN]`, tidak dijalankan di tahap ini): siapkan PostgreSQL lokal
→ `db/schema.sql` → `db/init.sql` → draft `4c2a` → `4g26` → `4g27` (`psql --single-transaction`) →
jalankan query verifikasi (`db/MIGRATION_CHECKLIST.md`, plan masing-masing) → buat owner → uji login →
`POST /api/birthday/editions` (buat edisi draf) → uji `POST /api/birthday/letters` & `PUT /api/archive`.

## 6. Yang SENGAJA tidak dilakukan

- Tidak mengubah UI live, `localStorage`, auth, media, atau perilaku ulang tahun.
- Tidak membuat akun/edisi/konten default; tidak menyemai data.
- Tidak menjalankan migration/SQL; tidak menyentuh Neon/PostgreSQL.
- Tidak mengklaim persistensi/DB berfungsi tanpa database nyata.
