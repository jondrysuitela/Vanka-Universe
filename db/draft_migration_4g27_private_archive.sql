-- ============================================================================
-- DRAFT MIGRATION 4G.27 — Private Archive ("Tentang Ibumu") Persistence
-- Target: PostgreSQL (Neon/local)
--
-- STATUS: DRAFT — BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL.
-- EDIT 4G.37B: dukungan audio DITUNDA — `media.chk_media_type` TIDAK disentuh.
-- Proyek tidak punya sistem migrasi; ini DRAFT SQL terpisah, bukan bagian dari
-- schema.sql/init.sql. Harus direview dan diuji sebelum diterapkan.
--
-- PENERAPAN: WAJIB satu transaksi tunggal:
--   psql --single-transaction -f db/draft_migration_4g27_private_archive.sql
--
-- URUTAN RELATIF TERHADAP DRAFT LAIN (tidak ada FK antar-draft; urutan untuk
-- kejelasan prasyarat, bukan ketergantungan silang):
--   1) db/schema.sql   (wajib: uuid-ossp, admins, media, birthday_editions)
--   2) db/init.sql     (wajib: fungsi update_updated_at_column)
--   3) db/draft_migration_4c2a_auth_foundation.sql   (auth; independen)
--   4) db/draft_migration_4g26_birthday_letters.sql  (surat; independen)
--   5) BERKAS INI (private_archives). HANYA membuat SATU tabel baru;
--      `media.chk_media_type` TIDAK disentuh (dukungan audio DITUNDA — 4G.37B).
--
-- IDEMPOTENSI: IF NOT EXISTS hanya mencocokkan NAMA, bukan definisi. Preflight
-- (§0) memverifikasi objek pra-ada tidak bertentangan.
--
-- KEPUTUSAN DESAIN (Tahap 4G.27; audio DITUNDA pada 4G.37B):
--   * Tabel khusus `private_archives`. Arsip privat SELALU privat → TIDAK ada
--     kolom `privacy`; otorisasi ditegakkan di server (sesi + role), bukan flag.
--   * `musicSrc` (string lokal) TIDAK dipersistensi sebagai URL/path. Audio
--     privat (bila kelak diaktifkan) HANYA lewat FK `music_media_id → media(id)`.
--   * DUKUNGAN AUDIO DITUNDA: `media.chk_media_type` DIBIARKAN `photo|video`;
--     TIDAK ada pelebaran CHECK. Kolom `music_media_id` tetap ada (UUID
--     nullable, FK ON DELETE RESTRICT) tetapi selalu NULL sampai ada media
--     bertipe 'audio'.
--   * `status` default 'draft'; domain `draft|archived` (arsip privat tidak
--     dipublikasikan publik; lihat db/PRIVATE_ARCHIVE_SCHEMA_PLAN.md §3).
--   * Tidak menyemai konten / admin. Tidak ada koleksi media arsip (belum ada
--     kontrak produk/ UI).
--
-- CATATAN PENTING: baris `media` TIDAK membuat file privat. Jalur akses file
-- tetap WAJIB memeriksa sesi + role di server (lihat db/PRIVATE_MEDIA_STORAGE_PLAN.md).
--
-- BACKUP & ROLLBACK:
--   * Snapshot/backup (atau Neon branch) sebelum menjalankan pada DB berisi data.
--   * Rollback = DROP TABLE private_archives (destruktif bila sudah ada konten)
--     + mengembalikan CHECK media (lihat db/PRIVATE_ARCHIVE_SCHEMA_PLAN.md §7).
--     JANGAN jalankan tanpa [PERLU IZIN].
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — read-only. RAISE EXCEPTION (=> rollback penuh) bila
--     prasyarat hilang atau objek pra-ada bertentangan. BELUM diuji di PostgreSQL.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text;
  v_data_type text;
  v_default   text;
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

  -- Drift checks only when the archive table already exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'private_archives'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('slug'),('title'),('narrative'),('music_enabled'),
                   ('music_media_id'),('status'),('created_by'),
                   ('created_at'),('updated_at')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'private_archives'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel private_archives sudah ada tetapi kolom hilang: %', v_missing;
    END IF;

    SELECT data_type INTO v_data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'music_media_id';
    IF v_data_type <> 'uuid' THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives.music_media_id bertipe % (harus uuid)', v_data_type;
    END IF;

    SELECT column_default INTO v_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'status';
    IF v_default IS NULL OR position('draft' IN v_default) = 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives.status default bukan draft (%)', COALESCE(v_default, 'NULL');
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       WHERE i.indrelid = 'public.private_archives'::regclass
         AND i.indisunique
         AND a.attname = 'slug'
         AND array_length(i.indkey, 1) = 1
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives.slug tidak UNIQUE';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.private_archives'::regclass
         AND c.contype = 'f'
         AND c.confrelid = 'public.media'::regclass
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives tidak punya FK ke media';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.private_archives'::regclass
         AND c.contype = 'f'
         AND c.confrelid = 'public.admins'::regclass
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives tidak punya FK ke admins';
    END IF;
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. private_archives
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private_archives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Stable identity / deterministic import key (e.g. "tentang-ibumu").
  slug VARCHAR(255) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL DEFAULT '',
  narrative TEXT NOT NULL DEFAULT '',
  -- Matches PrivateArchiveDraft.musicEnabled. May be true with no asset yet.
  music_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Private audio reference (nullable; audio DITUNDA — 4G.37B). FK only —
  -- NEVER a URL/path. RESTRICT so deleting a referenced media can never
  -- silently orphan the archive.
  music_media_id UUID REFERENCES media(id) ON DELETE RESTRICT,
  -- Private archive is never publicly published; 'archived' = frozen/preserved.
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_private_archive_status CHECK (status IN ('draft','archived'))
);

COMMENT ON TABLE private_archives IS
  'Arsip privat "Tentang Ibumu". Selalu privat (tanpa kolom privacy); otorisasi di server.';
COMMENT ON COLUMN private_archives.music_media_id IS
  'FK ke media(id) untuk audio privat. Tidak pernah URL/path. File tetap privat via route ber-sesi.';

-- slug UNIQUE sudah membuat index sendiri; tidak ada index duplikat.
CREATE INDEX IF NOT EXISTS idx_private_archives_status ON private_archives(status);
CREATE INDEX IF NOT EXISTS idx_private_archives_music_media ON private_archives(music_media_id);

-- ----------------------------------------------------------------------------
-- 2. updated_at trigger (fungsi berasal dari init.sql)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_private_archives_updated_at ON private_archives;
CREATE TRIGGER trg_private_archives_updated_at
BEFORE UPDATE ON private_archives
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Catatan implementasi (bukan SQL, tidak dieksekusi):
--   * Impor TIDAK dilakukan di sini. Rencana non-destruktif:
--       INSERT INTO private_archives(slug, ...) ON CONFLICT (slug) DO NOTHING
--     → baris yang sudah ada TIDAK pernah ditimpa.
--   * `musicSrc` dari localStorage TIDAK diimpor (bukan URL). Bila kelak ada
--     audio nyata, unggah dulu sebagai baris media bertipe 'audio', isi
--     `music_media_id`. Sebelum itu nilainya NULL.
--   * `music_media_id` (saat audio diaktifkan kelak) HARUS menunjuk media
--     media_type='audio' + privacy='private' — ditegakkan di lapisan aplikasi
--     (DB tidak bisa CHECK lintas-tabel). Saat ini selalu NULL (audio ditunda).
--   * Tidak ada seed/publish/default admin.
--   * Belum divalidasi terhadap PostgreSQL nyata.
-- ============================================================================

COMMIT;
