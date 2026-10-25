-- ============================================================================
-- 4G.46 — birthday_music (background music per birthday edition)
-- ============================================================================
-- STATUS: DRAFT / BELUM DIJALANKAN / BELUM DIVERIFIKASI PADA POSTGRES.
--
-- Wave A of the admin music upload feature: the STORAGE + API layer only.
-- The admin UI that writes to this table ships separately (Wave B), so this
-- migration is additive and inert until then.
--
-- WHY A TABLE AND NOT A FOLDER:
--   The song used to be a hand-placed file under `public/music/`. That means a
--   deploy to change a song, and no way to tell which song a past edition is
--   actually playing. One row per cycle year makes the choice explicit and
--   auditable, exactly like `birthday_letters` does for the letter.
--
-- KEYED BY EDITION, NOT BY AGE:
--   `birthday_editions` already keys by calendar year (age 1 = 2026) and is the
--   identity every other birthday table points at. Reusing it means a song can
--   never drift onto the wrong year.
--
-- BYTES LIVE IN THE MEDIA STORE:
--   `media_id` stores a provider-neutral media UUID, not a foreign key:
--   filesystem, legacy R2, and db-r2 keep media metadata in different places.
--   The API validates ids against the configured provider, and the media DELETE
--   route checks this table before removing a referenced file.
--
-- Safety: a `birthday_music` that already exists with the WRONG shape must
-- never be accepted silently, so a structural verification block runs inside
-- the same transaction and aborts the migration on any mismatch.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Foundation preflight: required building blocks must already exist.
-- ---------------------------------------------------------------------------
DO $foundation$
BEGIN
  IF to_regclass('public.birthday_editions') IS NULL THEN
    RAISE EXCEPTION 'Prasyarat gagal: tabel birthday_editions belum ada.';
  END IF;
  IF to_regprocedure('update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'Prasyarat gagal: fungsi update_updated_at_column() belum ada.';
  END IF;
END $foundation$;

CREATE TABLE IF NOT EXISTS birthday_music (
  -- One song per edition. The primary key IS the edition, so a second row for
  -- the same year cannot exist even by mistake.
  edition_id  UUID PRIMARY KEY REFERENCES birthday_editions(id) ON DELETE CASCADE,

  -- Provider-neutral media-store id. The configured provider remains the
  -- source of truth for whether the file exists and is audio.
  media_id    UUID,

  -- Human label shown in the admin (e.g. the file's original name).
  display_name VARCHAR(255),

  -- Volume trim per edition, 0..1. NULL = use the app default. Lets a loud
  -- track be tamed without re-encoding the file.
  volume      REAL,

  -- Set when an operator publishes the song; NULL while it is only a candidate.
  -- The public player only ever reads published rows (or falls back), so a
  -- half-finished upload can never surface publicly.
  published_at TIMESTAMPTZ,

  created_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT birthday_music_volume_range
    CHECK (volume IS NULL OR (volume >= 0 AND volume <= 1))
);

COMMENT ON TABLE birthday_music IS
  'Satu lagu latar per edisi ulang tahun (4G.46). Baris menyimpan PILIHAN lagu; byte-nya di media_objects.';
COMMENT ON COLUMN birthday_music.media_id IS
  'Media audio yang dipakai. NULL = tidak ada file yang bisa dipakai (pemutar memakai fallback).';
COMMENT ON COLUMN birthday_music.published_at IS
  'NULL = kandidat, belum tayang. Pemutar publik hanya membaca baris yang sudah dipublikasikan.';
COMMENT ON COLUMN birthday_music.volume IS
  '0..1, NULL = pakai default aplikasi. Hanya pengatur volume, bukan batas keamanan.';

-- ---------------------------------------------------------------------------
-- Structural verification: an existing table with the wrong shape must abort
-- the whole migration, not be silently accepted.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(expected.col, ', ')
    INTO missing
  FROM (
    VALUES
      ('edition_id'), ('media_id'), ('display_name'), ('volume'),
      ('published_at'), ('created_by'), ('created_at'), ('updated_at')
  ) AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'birthday_music'
      AND c.column_name = expected.col
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'birthday_music sudah ada tetapi kekurangan kolom: %', missing;
  END IF;
END $verify$;

-- Published songs are the only ones the public path looks up: one index.
CREATE INDEX IF NOT EXISTS idx_birthday_music_published
  ON birthday_music(published_at)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_birthday_music_media
  ON birthday_music(media_id);

-- ---------------------------------------------------------------------------
-- Allow the `music` pool and the `audio` kind in media_objects (4G.46).
-- Both CHECK constraints were created by 4G.40D-3B with only image/video and
-- birthday/archive. A DROP + ADD is used instead of trying to "extend" a CHECK
-- (Postgres has no ALTER for that), and it is idempotent: re-running replaces
-- the constraint with the same definition.
-- ---------------------------------------------------------------------------
DO $constraints$
BEGIN
  IF to_regclass('public.media_objects') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE media_objects DROP CONSTRAINT IF EXISTS chk_media_objects_collection;
  ALTER TABLE media_objects ADD CONSTRAINT chk_media_objects_collection
    CHECK (collection IN ('birthday', 'archive', 'music'));

  -- The kind column has no CHECK in every deployment; drop-if-exists keeps this
  -- safe whether or not one was ever added.
  ALTER TABLE media_objects DROP CONSTRAINT IF EXISTS chk_media_objects_kind;
  ALTER TABLE media_objects ADD CONSTRAINT chk_media_objects_kind
    CHECK (kind IN ('image', 'video', 'audio'));
END $constraints$;

-- ---------------------------------------------------------------------------
-- updated_at trigger (fungsi berasal dari init.sql)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_birthday_music_updated_at ON birthday_music;
CREATE TRIGGER trg_birthday_music_updated_at
BEFORE UPDATE ON birthday_music
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Catatan implementasi (bukan SQL, tidak dieksekusi):
--   * Tidak ada seed dan tidak ada baris yang dibuat di sini. Edisi tetap
--     memakai `public/music/vanka-<age>.mp3` (fallback) sampai sebuah lagu
--     dipublikasikan lewat tabel ini.
--   * Aplikasi menyuplai UUID sendiri (tidak ada uuid_generate_v4()).
--   * Rollback:
--       DROP TRIGGER IF EXISTS trg_birthday_music_updated_at ON birthday_music;
--       DROP TABLE IF EXISTS birthday_music;
--     Tidak ada tabel lain yang menyentuh tabel ini, jadi rollback aman.
-- ============================================================================

COMMIT;
