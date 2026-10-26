-- ============================================================================
-- DRAFT MIGRATION 4G.39 — Private Archive Gallery ("Arsip Ibu")
-- Target: PostgreSQL (Neon/local)
--
-- STATUS: DRAFT — BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL.
-- Proyek tidak punya sistem migrasi; ini DRAFT SQL terpisah, bukan bagian dari
-- schema.sql/init.sql. Harus direview dan diuji sebelum diterapkan.
-- Menjalankan pada DB berisi data = [PERLU IZIN] (lihat batas rollback di bawah).
--
-- PENERAPAN: satu transaksi tunggal (file sudah memuat BEGIN/COMMIT):
--   psql --single-transaction -f db/draft_migration_4g39_archive_gallery.sql
--
-- URUTAN RELATIF TERHADAP DRAFT LAIN:
--   1) db/schema.sql                                (uuid-ossp, admins, media)
--   2) db/init.sql                                  (fungsi update_updated_at_column)
--   3) db/draft_migration_4c2a_auth_foundation.sql  (auth)
--   4) db/draft_migration_4g26_birthday_letters.sql (surat)
--   5) db/draft_migration_4g27_private_archive.sql  (PRASYARAT: tabel private_archives)
--   6) BERKAS INI.  Membuat SATU tabel baru `private_archive_media`. TIDAK
--      menyentuh `private_archives`, `media`, atau CHECK apa pun (audio tetap
--      ditunda sejak 4G.37B).
--
-- IDEMPOTENSI: IF NOT EXISTS hanya mencocokkan NAMA, bukan definisi. Preflight
-- (§0) memverifikasi objek pra-ada tidak bertentangan.
--
-- KEPUTUSAN DESAIN:
--   * Satu tabel `private_archive_media` menyimpan DUA peran:
--       role='intro' = SATU video pembuka arsip (maks. satu per arsip, dijaga
--                      partial UNIQUE INDEX);
--      role='photo' = foto galeri, role='video' = video galeri; masing-masing
--                      diurutkan lewat kolom `position`.
--   * `media_id` = UUID dari MEDIA FILESYSTEM (`storage/media/index.json`,
--     dibuat `randomUUID()` oleh src/lib/media/store.ts). TIDAK ada FK ke
--     `public.media`: tabel itu belum dipakai runtime (0 baris) dan tidak
--     menyimpan id filesystem. Integritas media divalidasi di lapisan aplikasi
--     (kind 'image' untuk foto, 'video' untuk intro) saat menulis — DB tidak
--     bisa CHECK lintas-store.
--   * TIDAK ada kolom URL/path: hanya media id. Akses file tetap lewat
--     `/api/media/[id]` ber-sesi + role (lihat db/PRIVATE_MEDIA_STORAGE_PLAN.md).
--   * `archive_id → private_archives(id) ON DELETE CASCADE`: galeri adalah anak
--     arsip; hapus arsip (manual, terotorisasi) membersihkan barisnya. Tidak
--     pernah dihapus oleh API ini.
--   * Deskripsi PER-FOTO (title/description/memory_date) + `position` untuk
--     urutan galeri yang persisten. `created_at` = tanggal unggah (server-set).
--     Tidak ada satu deskripsi global.
--   * `media_id` TIDAK di-FK ke `media` (lihat di atas). Tipe tetap UUID agar
--     cocok dengan id filesystem; divalidasi di aplikasi.
--
-- BACKUP & ROLLBACK (DESTRUKTIF / SATU ARAH, [PERLU IZIN]):
--   * Snapshot/backup (atau Neon branch) sebelum menjalankan pada DB berisi data.
--   *   BEGIN; DROP TABLE IF EXISTS private_archive_media; COMMIT;
--     Menghapus koleksi galeri yang sudah diimpor; arsip (private_archives)
--     tetap. Tidak menyentuh file media di filesystem/object storage.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — read-only. RAISE EXCEPTION (=> rollback penuh) bila
--     prasyarat hilang atau objek pra-ada bertentangan. BELUM diuji di PostgreSQL.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
    RAISE EXCEPTION 'PREFLIGHT: extension uuid-ossp belum ada; jalankan db/schema.sql lebih dulu';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'admins'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel admins belum ada; jalankan db/schema.sql lebih dulu';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: fungsi update_updated_at_column belum ada; jalankan db/init.sql lebih dulu';
  END IF;

  -- PRASYARAT: arsip privat sudah ada (draft 4g27).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'private_archives'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel private_archives belum ada; jalankan db/draft_migration_4g27_private_archive.sql lebih dulu';
  END IF;

  -- Drift checks only when the gallery table already exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'private_archive_media'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('archive_id'),('media_id'),('role'),('title'),
                   ('description'),('memory_date'),('position'),
                   ('created_at'),('updated_at')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'private_archive_media'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel private_archive_media sudah ada tetapi kolom hilang: %', v_missing;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.private_archive_media'::regclass
         AND c.contype = 'f'
         AND c.confrelid = 'public.private_archives'::regclass
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archive_media tidak punya FK ke private_archives';
    END IF;
  END IF;

  -- Fail-closed: `media` harus ada (dibuat db/schema.sql) — diminta keberadaannya
  -- meski tidak di-FK, agar drift skema dasar terdeteksi lebih awal.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'media'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel media belum ada; jalankan db/schema.sql lebih dulu';
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. private_archive_media — galeri arsip privat (video pembuka + foto)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private_archive_media (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  archive_id   UUID NOT NULL REFERENCES private_archives(id) ON DELETE CASCADE,
  -- Id media FILESYSTEM (storage/media/index.json). SENGAJA bukan FK ke
  -- `media` (tabel itu belum dipakai runtime). Divalidasi di aplikasi.
  media_id     UUID NOT NULL,
  -- 'intro' = video pembuka; 'photo'/'video' = item galeri.
  role         VARCHAR(20) NOT NULL DEFAULT 'photo',
  -- Metadata PER-FOTO (tidak ada deskripsi global).
  title        VARCHAR(255) NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  memory_date  DATE,
  -- Urutan galeri (0-based). Server-set dari urutan yang dikirim admin.
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_private_archive_media_role CHECK (role IN ('intro','photo','video')),
  CONSTRAINT chk_private_archive_media_position CHECK (position >= 0),
  -- Satu media hanya boleh muncul sekali per arsip.
  CONSTRAINT uq_private_archive_media_media UNIQUE (archive_id, media_id)
);

COMMENT ON TABLE private_archive_media IS
  'Galeri arsip privat "Tentang Ibumu": video pembuka + foto/video berurutan. Referensi via media_id, bukan URL/path.';
COMMENT ON COLUMN private_archive_media.media_id IS
  'Id media filesystem (storage/media). Divalidasi di aplikasi (harus image/video sesuai role); bukan FK ke media (tabel media belum dipakai runtime).';
COMMENT ON COLUMN private_archive_media.memory_date IS
  'Tanggal kenangan opsional (YYYY-MM-DD). created_at = tanggal unggah (server).';

-- Maksimum satu video pembuka per arsip.
CREATE UNIQUE INDEX IF NOT EXISTS uq_private_archive_media_intro
  ON private_archive_media(archive_id) WHERE role = 'intro';

-- Urutan galeri + lookup referensi media.
CREATE INDEX IF NOT EXISTS idx_private_archive_media_order
  ON private_archive_media(archive_id, role, position);
CREATE INDEX IF NOT EXISTS idx_private_archive_media_media
  ON private_archive_media(media_id);

-- ----------------------------------------------------------------------------
-- 2. updated_at trigger (fungsi berasal dari init.sql)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_private_archive_media_updated_at ON private_archive_media;
CREATE TRIGGER trg_private_archive_media_updated_at
BEFORE UPDATE ON private_archive_media
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Catatan implementasi (bukan SQL, tidak dieksekusi):
--   * Tidak ada seed: 0 baris tepat setelah migrasi.
--   * Impor non-destruktif tidak dilakukan di sini. Aplikasi (GET/PUT
--     /api/archive/gallery) yang mengisi; `musicSrc` dari localStorage TIDAK
--     diimpor.
--   * File media TIDAK dibuat oleh baris ini; akses tetap lewat /api/media/[id]
--     yang wajib sesi + role (owner/admin).
--   * Penghapusan media yang direferensikan: FK tidak ada (bukan tabel media),
--     jadi jaminan RESTRICT lewat DB TIDAK berlaku; media delete saat ini
--     remain fail-closed di aplikasi (registry probe kosong -> "unverifiable").
--     Bila kelak probe referensi didaftarkan, ia harus membaca tabel ini.
--   * Belum divalidasi terhadap PostgreSQL nyata.
-- ============================================================================

COMMIT;
