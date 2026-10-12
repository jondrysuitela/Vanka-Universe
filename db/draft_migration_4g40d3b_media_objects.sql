-- ============================================================================
-- 4G.40D-3B/3D0 — media_objects (DATABASE source of truth for media metadata)
-- ============================================================================
-- STATUS: DRAFT / BELUM DIJALANKAN / BELUM DIVERIFIKASI PADA POSTGRES.
--
-- Additive table only. The legacy `media` table in db/schema.sql is NOT used and
-- is NOT altered: its shape (`media_type IN ('photo','video')`, `memory_id`,
-- `storage_key NOT NULL`) does not match the current MediaRecord contract
-- (`kind IN ('image','video')`). Forcing it would be a lossy contract change.
--
-- R2 stores BYTES only. This table is the single source of truth for metadata.
--
-- uuid-ossp is deliberately NOT required: `id` has NO server-side default here.
-- The application supplies the UUID (the same id used as the object key), so no
-- `uuid_generate_v4()` is called by this migration.
--
-- Lifecycle:
--   pending  -> row written, object upload in progress
--   ready    -> object upload confirmed; row is user-visible
-- `pending` rows are NEVER returned by the app store (list/find/read), so a
-- half-finished upload is invisible. They ARE listable by an operator/cleanup
-- job via a plain SELECT on the status column (no hidden rows). See
-- `src/lib/media/db/reconcile.ts` for the (not-yet-wired) reconciliation plan.
--
-- Safety: a `media_objects` that already exists but has the WRONG shape must
-- never be accepted silently. Because `CREATE TABLE IF NOT EXISTS` would leave
-- such a table untouched, a structural verification block runs INSIDE the same
-- transaction and aborts the whole migration on any mismatch.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Foundation preflight: required building blocks must already exist.
-- (uuid-ossp is intentionally NOT checked here — this table does not need it.)
-- ----------------------------------------------------------------------------
DO $foundation$
BEGIN
  IF to_regclass('public.admins') IS NULL THEN
    RAISE EXCEPTION 'Prasyarat gagal: tabel admins belum ada.';
  END IF;
  IF to_regprocedure('update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'Prasyarat gagal: fungsi update_updated_at_column() belum ada.';
  END IF;
END $foundation$;

CREATE TABLE IF NOT EXISTS media_objects (
  id               UUID PRIMARY KEY,               -- raw UUID, never a URL/path
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  storage_provider VARCHAR(50) NOT NULL DEFAULT 'r2',
  storage_key      VARCHAR(512) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  kind             VARCHAR(50) NOT NULL,           -- image|video
  file_size        BIGINT NOT NULL,
  display_name     VARCHAR(255) NOT NULL,
  owner_id         UUID REFERENCES admins(id) ON DELETE SET NULL,
  owner_label      VARCHAR(255),
  collection       VARCHAR(20) NOT NULL DEFAULT 'birthday',  -- birthday|archive (4G.42B)
  title            VARCHAR(255),
  description      TEXT,
  taken_at         DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_media_objects_status   CHECK (status IN ('pending','ready')),
  CONSTRAINT chk_media_objects_kind     CHECK (kind IN ('image','video')),
  CONSTRAINT chk_media_objects_collection CHECK (collection IN ('birthday','archive')),
  CONSTRAINT chk_media_objects_size     CHECK (file_size >= 0),
  CONSTRAINT chk_media_objects_provider CHECK (storage_provider IN ('r2','s3'))
);

CREATE INDEX IF NOT EXISTS idx_media_objects_status     ON media_objects(status);
CREATE INDEX IF NOT EXISTS idx_media_objects_created_at ON media_objects(created_at);
CREATE INDEX IF NOT EXISTS idx_media_objects_owner      ON media_objects(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_collection ON media_objects(collection);

DROP TRIGGER IF EXISTS trg_media_objects_updated_at ON media_objects;
CREATE TRIGGER trg_media_objects_updated_at
  BEFORE UPDATE ON media_objects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Structural verification (same transaction). If `media_objects` pre-existed
-- with a different shape, `CREATE TABLE IF NOT EXISTS` left it untouched and the
-- missing CHECK/FK/trigger would go unnoticed. Abort loudly instead.
-- ----------------------------------------------------------------------------
DO $structure$
DECLARE
  missing_columns     text;
  missing_constraints text;
  pk_ok               boolean;
  fk_ok               boolean;
  trigger_ok          boolean;
  status_default      text;
  collection_default  text;
BEGIN
  SELECT string_agg(c.name, ', ' ORDER BY c.name) INTO missing_columns
    FROM (VALUES
      ('id'), ('status'), ('storage_provider'), ('storage_key'), ('mime_type'),
      ('kind'), ('file_size'), ('display_name'), ('owner_id'), ('owner_label'),
      ('collection'), ('title'), ('description'), ('taken_at'), ('created_at'),
      ('updated_at')
    ) AS c(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'media_objects'
        AND column_name = c.name
   );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; kolom hilang: %', missing_columns;
  END IF;

  SELECT string_agg(x.name, ', ' ORDER BY x.name) INTO missing_constraints
    FROM (VALUES
      ('chk_media_objects_status'), ('chk_media_objects_kind'),
      ('chk_media_objects_collection'), ('chk_media_objects_size'),
      ('chk_media_objects_provider')
    ) AS x(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.media_objects'::regclass
        AND conname = x.name
   );
  IF missing_constraints IS NOT NULL THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; constraint hilang: %', missing_constraints;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.media_objects'::regclass
       AND contype = 'p'
       AND pg_get_constraintdef(oid) ILIKE 'PRIMARY KEY (id)'
  ) INTO pk_ok;
  IF NOT pk_ok THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; PRIMARY KEY (id) hilang atau berbeda.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.media_objects'::regclass
       AND contype = 'f'
       AND confrelid = 'public.admins'::regclass
  ) INTO fk_ok;
  IF NOT fk_ok THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; FK owner_id -> admins hilang.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.media_objects'::regclass
       AND tgname = 'trg_media_objects_updated_at'
       AND NOT tgisinternal
  ) INTO trigger_ok;
  IF NOT trigger_ok THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; trigger updated_at hilang.';
  END IF;

  SELECT column_default INTO status_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'media_objects' AND column_name = 'status';
  IF status_default IS NULL OR status_default NOT ILIKE '%pending%' THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; default status bukan pending (%).', status_default;
  END IF;

  SELECT column_default INTO collection_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'media_objects' AND column_name = 'collection';
  IF collection_default IS NULL OR collection_default NOT ILIKE '%birthday%' THEN
    RAISE EXCEPTION 'media_objects sudah ada tetapi bentuknya salah; default collection bukan birthday (%).', collection_default;
  END IF;
END $structure$;

COMMIT;
