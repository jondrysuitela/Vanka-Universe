-- ============================================================================
-- DRAFT MIGRATION 4G.39V — Allow videos in the private archive gallery
-- Target: PostgreSQL (Neon/local)
--
-- Additive migration for databases where 4g39 was applied before video gallery
-- items were supported. The updated 4g39 draft already includes this role for
-- fresh databases; this file is safe to apply after either version.
--
-- STATUS: DRAFT — not applied or validated against a production database.
-- Review and back up any database with data before applying.
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'private_archive_media'
  ) THEN
    RAISE EXCEPTION
      'PREFLIGHT: private_archive_media is missing; apply draft migration 4g39 first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'private_archive_media'
       AND column_name = 'role'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: private_archive_media.role is missing';
  END IF;
END
$preflight$;

ALTER TABLE private_archive_media
  DROP CONSTRAINT IF EXISTS chk_private_archive_media_role;

ALTER TABLE private_archive_media
  ADD CONSTRAINT chk_private_archive_media_role
  CHECK (role IN ('intro', 'photo', 'video'));

COMMENT ON TABLE private_archive_media IS
  'Private archive media: one intro video plus ordered gallery photos and videos, referenced by media_id.';

COMMIT;
