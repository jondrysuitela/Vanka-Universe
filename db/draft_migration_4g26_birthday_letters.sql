-- ============================================================================
-- DRAFT MIGRATION 4G.26 — Birthday Letter Persistence (birthday_letters)
-- Target: PostgreSQL (Neon/local)
--
-- STATUS: DRAFT — BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL.
-- Proyek tidak punya sistem migrasi; ini DRAFT SQL terpisah, bukan bagian dari
-- schema.sql/init.sql. Harus direview dan diuji sebelum diterapkan.
--
-- PENERAPAN: WAJIB satu transaksi tunggal:
--   psql --single-transaction -f db/draft_migration_4g26_birthday_letters.sql
-- (atau BEGIN/COMMIT eksplisit seperti di bawah) agar kegagalan di tengah tidak
-- meninggalkan migrasi separuh jalan.
--
-- DEPENDENSI: db/schema.sql (extension uuid-ossp, tabel admins,
-- birthday_editions) DAN db/init.sql (fungsi update_updated_at_column) harus
-- sudah diterapkan lebih dulu. Bukan dependensi dari draft auth 4C.2a; kedua
-- draft berdiri sendiri dan TIDAK mengubah semantik satu sama lain.
--
-- IDEMPOTENSI: IF NOT EXISTS hanya mencocokkan NAMA objek, bukan definisi.
-- Preflight di §0 yang memverifikasi objek pra-ada tidak bertentangan.
--
-- FRESH vs UPGRADE:
--   * FRESH  : database kosong → schema.sql → init.sql → berkas ini.
--   * UPGRADE: schema.sql + init.sql sudah ada. Berkas ini ADITIF: hanya
--              membuat SATU tabel baru (birthday_letters) + index + trigger.
--              Tidak mengubah/menghapus tabel, kolom, data, atau trigger lain.
--   * Preflight memverifikasi prasyarat & drift sebelum DDL dijalankan.
--
-- KEPUTUSAN DESAIN (Tahap 4G.26):
--   * Surat disimpan di tabel KHUSUS `birthday_letters` (bukan `content`):
--     kepemilikan jelas, 1 surat per edisi ditegakkan UNIQUE(edition_id), dan
--     tabel generik `content` tidak dikotori kolom khusus-ulang-tahun.
--   * full_text = teks kanonik surat.
--   * sections = JSONB (array LetterSection[]), urutan & struktur terjaga.
--   * thumbnail = JSONB ({src?,alt,caption?}) atau NULL.
--   * display_date = VARCHAR (string tampilan, BUKAN tipe DATE).
--   * status default 'draft'; tidak ada seed/publish.
--   * TIDAK menyimpan musicSrc / URL media privat apa pun di sini.
--
-- BACKUP & ROLLBACK:
--   * Snapshot/backup (atau Neon branch) sebelum menjalankan pada DB berisi data.
--   * Rollback = DROP TABLE birthday_letters (destruktif; lihat catatan di
--     db/BIRTHDAY_PERSISTENCE_PLAN.md). Setelah impor surat, rollback kehilangan
--     surat tersebut. JANGAN jalankan tanpa [PERLU IZIN].
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — read-only. RAISE EXCEPTION (=> rollback penuh, tanpa DDL) bila
--    prasyarat hilang atau objek pra-ada bertentangan. BELUM diuji di PostgreSQL.
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
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'birthday_editions'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel birthday_editions belum ada; jalankan db/schema.sql lebih dulu';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: fungsi update_updated_at_column belum ada; jalankan db/init.sql lebih dulu';
  END IF;

  -- Drift checks only when the table already exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'birthday_letters'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('edition_id'),('title'),('display_date'),('full_text'),
                   ('sections'),('thumbnail'),('status'),('created_by'),
                   ('created_at'),('updated_at'),('scheduled_at'),('published_at')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'birthday_letters'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel birthday_letters sudah ada tetapi kolom hilang: %', v_missing;
    END IF;

    SELECT data_type INTO v_data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'birthday_letters' AND column_name = 'sections';
    IF v_data_type <> 'jsonb' THEN
      RAISE EXCEPTION 'PREFLIGHT: birthday_letters.sections bertipe % (harus jsonb)', v_data_type;
    END IF;

    SELECT data_type INTO v_data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'birthday_letters' AND column_name = 'thumbnail';
    IF v_data_type <> 'jsonb' THEN
      RAISE EXCEPTION 'PREFLIGHT: birthday_letters.thumbnail bertipe % (harus jsonb)', v_data_type;
    END IF;

    SELECT column_default INTO v_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'birthday_letters' AND column_name = 'status';
    IF v_default IS NULL OR position('draft' IN v_default) = 0 THEN
      RAISE EXCEPTION 'PREFLIGHT: birthday_letters.status default bukan draft (%)', COALESCE(v_default, 'NULL');
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
       WHERE i.indrelid = 'public.birthday_letters'::regclass
         AND i.indisunique
         AND a.attname = 'edition_id'
         AND array_length(i.indkey, 1) = 1
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: birthday_letters.edition_id tidak UNIQUE';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.birthday_letters'::regclass
         AND c.contype = 'f'
         AND c.confrelid = 'public.birthday_editions'::regclass
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: birthday_letters tidak punya FK ke birthday_editions';
    END IF;
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. birthday_letters
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS birthday_letters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Exactly one letter per edition; RESTRICT so deleting an edition can never
  -- silently destroy a letter.
  edition_id UUID NOT NULL UNIQUE REFERENCES birthday_editions(id) ON DELETE RESTRICT,
  title VARCHAR(255) NOT NULL DEFAULT '',
  -- Presentational string from the draft (e.g. "27 Oktober 2026"). Deliberately
  -- NOT a DATE/TIMESTAMPTZ: no canonical date contract exists yet.
  display_date VARCHAR(255) NOT NULL DEFAULT '',
  -- Canonical letter text.
  full_text TEXT NOT NULL DEFAULT '',
  -- LetterSection[] — order and structure preserved.
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { src?, alt, caption? } | NULL. Only PUBLIC paths; never private media.
  thumbnail JSONB,
  -- Imported/most content starts as draft. Mirrors the `content` status domain.
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_birthday_letter_status CHECK (status IN ('draft','review','scheduled','published','archived')),
  CONSTRAINT chk_birthday_letter_sections CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT chk_birthday_letter_thumbnail CHECK (thumbnail IS NULL OR jsonb_typeof(thumbnail) = 'object'),
  CONSTRAINT chk_birthday_letter_sched CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CONSTRAINT chk_birthday_letter_pub CHECK (status <> 'published' OR published_at IS NOT NULL)
);

COMMENT ON TABLE birthday_letters IS
  'Surat ulang tahun per edisi (1:1 dengan birthday_editions). full_text kanonik; sections & thumbnail sebagai JSONB.';
COMMENT ON COLUMN birthday_letters.display_date IS
  'String tanggal tampilan (bukan DATE). Tidak boleh di-cast ke DATE tanpa kontrak tanggal kanonik.';
COMMENT ON COLUMN birthday_letters.thumbnail IS
  'JSONB {src?,alt,caption?} atau NULL. Hanya path publik; media privat TIDAK boleh.';

-- edition_id UNIQUE sudah membuat index sendiri; tidak ada index duplikat.
CREATE INDEX IF NOT EXISTS idx_birthday_letters_status ON birthday_letters(status);
CREATE INDEX IF NOT EXISTS idx_birthday_letters_created_at ON birthday_letters(created_at);

-- ----------------------------------------------------------------------------
-- 2. updated_at trigger (fungsi berasal dari init.sql)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_birthday_letters_updated_at ON birthday_letters;
CREATE TRIGGER trg_birthday_letters_updated_at
BEFORE UPDATE ON birthday_letters
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- Catatan implementasi (bukan SQL, tidak dieksekusi):
--   * Impor TIDAK dilakukan di berkas ini. Rencana impor non-destruktif:
--       edisi   : INSERT INTO birthday_editions(year, ...) ON CONFLICT (year) DO NOTHING
--       surat   : INSERT INTO birthday_letters(edition_id, ... status='draft')
--                 ON CONFLICT (edition_id) DO NOTHING
--     Keduanya DO NOTHING → baris yang sudah ada TIDAK pernah ditimpa diam-diam.
--   * Tidak ada seed/publish/default admin di migrasi ini.
--   * Verifikasi & batas rollback: lihat db/BIRTHDAY_PERSISTENCE_PLAN.md.
--   * Belum divalidasi terhadap PostgreSQL nyata.
-- ============================================================================

COMMIT;
