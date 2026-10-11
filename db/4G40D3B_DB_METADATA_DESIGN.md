# 4G.40D-3B — Database as Media Metadata Source of Truth (R2 = bytes)

STATUS: implementation lokal, mock-only. **Belum aktif secara default.**
Migration masih **DRAFT** (belum dijalankan). Tidak ada resource eksternal berubah.

## Ringkasan keputusan (Opsi 2)

- Sumber kebenaran metadata media = tabel PostgreSQL baru `media_objects`.
- R2 hanya menyimpan **byte** file (lewat `MediaObjectClient`).
- Tabel `media` lama di `db/schema.sql` **tidak dipakai dan tidak diubah**
  (bentuk kolomnya tidak cocok dengan `MediaRecord`: `media_type IN
  ('photo','video')` vs `kind IN ('image','video')`).
- Provider default tetap `filesystem`. `storage/index.ts` **tidak diubah**:
  store DB-R2 belum terdaftar sebagai driver, jadi perilaku produksi identik.

## File

Baru:
- `db/draft_migration_4g40d3b_media_objects.sql` — DRAFT aditif.
- `src/lib/media/db/errors.ts` — error fail-closed bertipe.
- `src/lib/media/db/repository.ts` — akses `media_objects` (satu statement per operasi).
- `src/lib/media/storage/object-client.ts` — `MediaObjectClient` + adapter R2 (byte saja).
- `src/lib/media/storage/db-media-store.ts` — `createDbMediaStore` (lifecycle pending→ready).
- `src/lib/media/db/__tests__/repository.test.ts`
- `src/lib/media/storage/__tests__/db-media-store.test.ts`
- `src/lib/media/storage/__tests__/object-client.test.ts`
- `src/lib/media/__tests__/db-media-delete-reference.test.ts`
- `src/lib/db/__tests__/media-objects-migration.test.ts`

Tidak diubah: `storage/index.ts`, `storage/filesystem.ts`, `r2.ts`, `store.ts`,
seluruh route API, `.env.local`, tabel `media`.

## Lifecycle & jendela kegagalan

Urutan unggah: INSERT `pending` -> PUT objek → UPDATE `ready`.

| # | Titik gagal | Objek R2 | Baris DB | Kompensasi |
|---|-------------|----------|----------|------------|
| 1 | INSERT pending gagal | tidak ada | tidak ada | tidak perlu |
| 2 | PUT object gagal | tidak ada / partial | pending | `DELETE` baris; gagal → `MediaMetadataIntegrityError` |
| 3 | flip ready gagal | ada | pending | hapus objek + hapus baris; gagal → `MediaMetadataIntegrityError` |

- Baris `pending` **tidak pernah** terlihat oleh pengguna (`list`/`find`/`read`
  hanya `status = 'ready'`).
- Baris `pending` **bisa** diambil operator lewat `listMediaObjectsByStatus(pool,
  'pending')` untuk rekonsiliasi. Tidak ada baris tersembunyi.
- Urutan ini mencegah object tanpa metadata (worst case = baris `pending`).

## Failure window hapus

`remove()`:
1. `DELETE ... RETURNING` (satu statement; dua delete bersamaan tidak bisa
  sama-sama menang).
2. hapus objek R2.
   - gagal (bukan 404) → kompensasi `INSERT ... ON CONFLICT (id) DO NOTHING`
     untuk memulihkan baris; jika pemulihan gagal → `MediaMetadataIntegrityError`.
   - objek sudah hilang (404/NoSuchKey) dianggap sukses (idempotent).

## Batasan integritas (jujur)

- Upload R2 dan tulis DB **tidak atomik**. Setiap jendela di atas ditangani
  eksplisit; kegagalan kompensasi memunculkan `MediaMetadataIntegrityError`.
- `DbPool` hanya punya `query()` → tidak ada `BEGIN/COMMIT`. Semua operasi DB
  adalah **satu statement**. Tidak ada klaim transaksi lintas-query.
- Progressive/concurrent update hilang? Tidak ada read-modify-write bersama:
  tiap upload memakai UUID sendiri, dan `UPDATE ... WHERE id = $1` atomik.
- Baris `pending` yang tertinggal (kegagalan kompensasi) **tidak pernah**
  tampil ke user; perlu job rekonsiliasi ops (`SELECT ... WHERE status =
  'pending'`), belum diimplementasikan.

## Verifikasi (fase ini)

- Test suite penuh: **547 passed / 46 files** (sebelumnya 501/41; +46 test baru).
- ESLint: bersih pada file baru.
- `tsc --noEmit`: **28 error (sama seperti baseline), 0 error baru**.
- Tidak dipanggil: R2, database, migrasi, build, restart server.

## Langkah integrasi berikutnya (butuh approval terpisah)

1. Review desain ini.
2. Jalankan migrasi `4g40d3b` di `test-arsip-ibu` (bukan produksi) — butuh persetujuan.
3. Verifikasi CRUD DB-R2 (fake → nyata) pada bucket test.
4. Daftarkan driver baru di `storage/index.ts` di belakang flag, lalu:
   - probe referensi galeri tetap fail-closed;
   - E2E admin (upload, tampil di galeri, hapus).
5. Rencana cutover `metadata` dari `index.json` (filesystem) ke `media_objects`
   bila verifikasi hijau.
