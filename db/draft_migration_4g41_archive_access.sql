-- ============================================================================
-- DRAFT MIGRATION 4G.41 — Private-Archive VISITOR Access (PIN + visitor sessions)
-- Target: PostgreSQL (Neon/local)
--
-- STATUS: DRAFT — BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL.
-- Proyek tidak punya sistem migrasi; ini DRAFT SQL terpisah, bukan bagian dari
-- schema.sql/init.sql. Harus direview dan diuji sebelum diterapkan.
--
-- PENERAPAN: WAJIB satu transaksi tunggal:
--   psql --single-transaction -f db/draft_migration_4g41_archive_access.sql
--
-- PRASYARAT:
--   1) db/schema.sql   (uuid-ossp, admins)
--   2) db/init.sql     (fungsi update_updated_at_column; tidak dipakai tabel ini,
--                       tetap diminta oleh preflight demi konsistensi fondasi)
--   3) db/draft_migration_4c2a_auth_foundation.sql  (auth; independen)
--   4) db/draft_migration_4g27_private_archive.sql  (WAJIB: tabel private_archives)
--   5) BERKAS INI.  ADITIF: menambah 4 kolom ke private_archives + 2 tabel baru.
--
-- IDEMPOTENSI: IF NOT EXISTS hanya mencocokkan NAMA, bukan definisi. Preflight
-- (§0) memverifikasi objek pra-ada tidak bertentangan.
--
-- KEPUTUSAN DESAIN (Tahap VU-ARCHIVE-ACCESS-3A):
--   * PIN arsip adalah kredensial TERPISAH dari password admin. PIN disimpan
--     HANYA sebagai hash bcrypt (`pin_hash`); plaintext TIDAK pernah disimpan.
--   * Sesi pengunjung adalah kanal TERPISAH dari sesi admin: tabel
--     `archive_access_sessions` (tanpa admin_id) + cookie sendiri
--     (`vanka_archive_access`). Tidak bisa memenuhi guard/role admin.
--   * Pencabutan saat PIN berubah: kolom `access_version` di naikkan; validasi
--     sesi mensyaratkan `session.access_version = archive.access_version`,
--     sehingga SEMUA sesi lama langsung invalid tanpa menyentuh barisnya.
--   * Fail-closed: `access_enabled=false` ATAU `pin_hash IS NULL` menutup akses.
--   * Rate limit PIN per-IP + brake global (lihat policy.ts).
--   * Tidak menyemai PIN, admin, atau baris apa pun. TIDAK ada PIN default.
--
-- CATATAN PENTING: memberi `pin_hash` BUKAN mengaktifkan UI. Endpoint dan UI
-- pengunjung dibangun pada tahap terpisah; migrasi ini hanya skema.
--
-- BACKUP & ROLLBACK:
--   * Snapshot/backup (atau Neon branch) sebelum menjalankan pada DB berisi data.
--   * Rollback (destruktif bila sudah ada data sesi):
--       DROP TABLE IF EXISTS archive_access_attempts;
--       DROP TABLE IF EXISTS archive_access_sessions;
--       ALTER TABLE private_archives
--         DROP COLUMN IF EXISTS pin_updated_at,
--         DROP COLUMN IF EXISTS access_version,
--         DROP COLUMN IF EXISTS access_enabled,
--         DROP COLUMN IF EXISTS pin_hash;
--     JANGAN jalankan tanpa [PERLU IZIN].
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — read-only. RAISE EXCEPTION (=> rollback penuh) bila prasyarat
--    hilang atau objek pra-ada bertentangan. BELUM diuji di PostgreSQL.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_missing   text;
  v_data_type text;
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

  -- Prasyarat: private_archives (draft 4g27). Migrasi ini ADITIF terhadapnya.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'private_archives'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel private_archives belum ada; jalankan db/draft_migration_4g27_private_archive.sql lebih dulu';
  END IF;

  -- private_archives dasar: wajib punya id + slug (kolom yang kita sandari).
  SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
    FROM (VALUES ('id'),('slug')) AS c(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = 'private_archives'
        AND ic.column_name = c.col
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel private_archives sudah ada tetapi kolom hilang: %', v_missing;
  END IF;

  -- Bila kolom kita sudah ada, tipenya harus benar (drift guard).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'pin_hash'
  ) THEN
    SELECT data_type INTO v_data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'pin_hash';
    IF v_data_type <> 'text' THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives.pin_hash ada dengan tipe % (harus text)', v_data_type;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'access_version'
  ) THEN
    SELECT data_type INTO v_data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'private_archives' AND column_name = 'access_version';
    IF v_data_type <> 'integer' THEN
      RAISE EXCEPTION 'PREFLIGHT: private_archives.access_version ada dengan tipe % (harus integer)', v_data_type;
    END IF;
  END IF;

  -- archive_access_sessions, IF present, must contain every required column.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'archive_access_sessions'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('token_hash'),('access_version'),('expires_at'),
                   ('created_at'),('revoked_at'),('ip_address'),('user_agent')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'archive_access_sessions'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel archive_access_sessions sudah ada tetapi kolom hilang: %', v_missing;
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'archive_access_sessions'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'token_hash'
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: archive_access_sessions.token_hash tidak UNIQUE';
    END IF;
  END IF;

  -- archive_access_attempts, IF present, must contain every required column.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'archive_access_attempts'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('ip_address'),('success'),('attempted_at')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'archive_access_attempts'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel archive_access_attempts sudah ada tetapi kolom hilang: %', v_missing;
    END IF;
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. private_archives — visitor access columns (additive)
-- ----------------------------------------------------------------------------
-- pin_hash: bcrypt hash of the visitor PIN. NULL = access closed (fail-closed).
ALTER TABLE private_archives
  ADD COLUMN IF NOT EXISTS pin_hash TEXT;

COMMENT ON COLUMN private_archives.pin_hash IS
  'Hash bcrypt PIN arsip (kredensial TERPISAH dari password admin). NULL = akses ditutup.';

-- access_enabled: operator switch. false closes the archive to visitors.
ALTER TABLE private_archives
  ADD COLUMN IF NOT EXISTS access_enabled BOOLEAN NOT NULL DEFAULT true;

-- access_version: bumped whenever the PIN changes; visitor sessions snapshot
-- this value and are invalidated in bulk when it changes.
ALTER TABLE private_archives
  ADD COLUMN IF NOT EXISTS access_version INTEGER NOT NULL DEFAULT 1;

-- pin_updated_at: audit-friendly timestamp of the last PIN change (informational).
ALTER TABLE private_archives
  ADD COLUMN IF NOT EXISTS pin_updated_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. archive_access_sessions — VISITOR sessions (no admin_id)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archive_access_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- SHA-256 hex of the visitor token (exactly 64 chars). Raw token only in cookie.
  token_hash     VARCHAR(64) NOT NULL UNIQUE,
  -- Snapshot of private_archives.access_version at issue time (revocation key).
  access_version INTEGER NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ,
  ip_address     VARCHAR(100),
  user_agent     TEXT
);

COMMENT ON TABLE archive_access_sessions IS
  'Sesi PENGUNJUNG arsip privat (tanpa admin_id). Token hanya di cookie; DB simpan hash.';

-- Sweep/lookup of live sessions by expiry.
CREATE INDEX IF NOT EXISTS idx_archive_access_sessions_expires_at
  ON archive_access_sessions(expires_at)
  WHERE revoked_at IS NULL;

-- token_hash UNIQUE sudah membuat index lookup-nya sendiri.

-- ----------------------------------------------------------------------------
-- 3. archive_access_attempts — PIN rate limiting (per IP + global brake)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archive_access_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address   VARCHAR(100) NOT NULL,
  success      BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE archive_access_attempts IS
  'Riwayat percobaan PIN arsip untuk rate limiting sliding-window per IP + brake global.';

CREATE INDEX IF NOT EXISTS idx_archive_access_attempts_ip_time
  ON archive_access_attempts(ip_address, attempted_at DESC);

-- Index for the global (all-IP) failure count in the same window.
CREATE INDEX IF NOT EXISTS idx_archive_access_attempts_time
  ON archive_access_attempts(attempted_at DESC);

-- Catatan APLIKASI (bukan SQL):
--   * RETENSI: archive_access_attempts tumbuh tanpa batas. Prune > 30 hari
--     (job manual/belum dijadwalkan) — sama seperti login_attempts.
--   * Akses ditolak bila: tidak ada baris private_archives, access_enabled=false,
--     pin_hash IS NULL, sesi expired/revoked, atau access_version tidak cocok.
--   * Tidak ada seed PIN / admin / konten.

COMMIT;
