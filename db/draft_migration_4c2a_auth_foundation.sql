-- ============================================================================
-- DRAFT MIGRATION 4C.2a — Auth Foundation (sessions + login_attempts + hash)
-- Target: PostgreSQL (Neon)
--
-- STATUS: DRAFT — BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL.
-- Proyek tidak punya sistem migrasi; file ini DRAFT SQL terpisah, bukan bagian
-- dari schema.sql/init.sql. Harus direview dan diuji sebelum diterapkan.
--
-- PENERAPAN: WAJIB satu transaksi tunggal. Jalankan via
--   psql --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql
-- (atau pada sesi psql dengan BEGIN/COMMIT eksplisit seperti di bawah), agar
-- kegagalan di tengah tidak meninggalkan migrasi separuh jalan.
--
-- IDEMPOTENSI: IF NOT EXISTS hanya mencocokkan NAMA objek. Ia TIDAK menjamin
-- migrasi sepenuhnya idempoten — bila objek dengan nama sama sudah ada tetapi
-- definisi/kolomnya berbeda, perintah dilewati diam-diam tanpa peringatan.
-- Belum ada versi/riwayat migrasi untuk mendeteksi drift.
--
-- PRASYARAT: schema.sql (dan init.sql) harus sudah diterapkan lebih dulu
-- (extension uuid-ossp + tabel admins). Jika belum, draft ini GAGAL.
--
-- FRESH vs UPGRADE (Tahap 4G.24):
--   * FRESH install  : database kosong. Urutan: schema.sql -> init.sql ->
--                      berkas ini. Preflight di bawah akan lolos (objek belum ada).
--   * UPGRADE        : database sudah punya schema.sql. Berkas ini bersifat
--                      ADITIF (menambah kolom password_hash + 2 tabel baru) dan
--                      TIDAK menyentuh data/tabel lama. Preflight memverifikasi
--                      objek yang SUDAH ada tidak bertentangan sebelum DDL jalan.
--   * IF NOT EXISTS di bawah HANYA mencocokkan NAMA, bukan definisi. Karena itu
--     preflight-lah (bukan IF NOT EXISTS) yang mencegah objek pra-ada dengan
--     definisi berbeda dilewati diam-diam.
--
-- PREFLIGHT (read-only, dalam transaksi yang sama, dijalankan SEBELUM DDL):
--   blok DO $preflight$ ... memverifikasi prasyarat & mendeteksi drift:
--     - extension uuid-ossp ada; tabel admins ada; admins.email UNIQUE;
--     - bila admins.password_hash ada, tipenya harus text;
--     - bila sessions/login_attempts ada, kolom wajibnya harus lengkap;
--     - bila sessions ada, token_hash harus UNIQUE.
--   Semua pelanggaran -> RAISE EXCEPTION, jadi transaksi rollback dan TIDAK ada
--   DDL yang diterapkan. Preflight ini BELUM diuji terhadap PostgreSQL nyata.
--
-- BACKUP & ROLLBACK:
--   * WAJIB snapshot/backup (atau Neon branch) sebelum menjalankan pada database
--     berisi data. Karena satu transaksi, kegagalan = rollback otomatis; tetapi
--     transaksi TIDAK memperbaiki objek pra-ada yang definisinya berbeda.
--   * Rollback manual (DROP) bersifat destruktif dan HANYA didokumentasikan di
--     db/MIGRATION_CHECKLIST.md Phase 5; JANGAN dijalankan tanpa [PERLU IZIN].
--
-- Prinsip:
--   * Tidak menghapus/menimpa data atau objek yang sudah ada.
--   * Tidak menyentuh kebijakan append-only audit_logs / trigger-nya.
--   * Tidak menambah event audit (entity_type CHECK tetap apa adanya).
--   * Tidak menyemai akun admin apa pun.
--   * password_hash TIDAK pernah menyimpan plaintext.
--   * Akun dinonaktifkan via is_active=false, TIDAK dihapus.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PREFLIGHT — read-only drift/knockout checks. Fails the whole transaction
--    (RAISE EXCEPTION -> rollback) BEFORE any DDL, if a conflicting or
--    incompatible object already exists. NOT yet verified against real PostgreSQL.
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_type    text;
  v_missing text;
BEGIN
  -- Prerequisite: uuid-ossp extension (default PK uuid_generate_v4()).
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
    RAISE EXCEPTION 'PREFLIGHT: extension uuid-ossp belum ada; jalankan db/schema.sql lebih dulu';
  END IF;

  -- Prerequisite: admins table (FK target + password_hash host).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'admins'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: tabel admins belum ada; jalankan db/schema.sql lebih dulu';
  END IF;

  -- admins.email must be UNIQUE (create-owner.mjs relies on ON CONFLICT (email)).
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = 'public'
       AND tc.table_name = 'admins'
       AND tc.constraint_type = 'UNIQUE'
       AND kcu.column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: admins.email tidak UNIQUE';
  END IF;

  -- admins.password_hash, IF present, must be text (drift guard).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'password_hash'
  ) THEN
    SELECT data_type INTO v_type
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'password_hash';
    IF v_type <> 'text' THEN
      RAISE EXCEPTION 'PREFLIGHT: admins.password_hash ada dengan tipe % (harus text)', v_type;
    END IF;
  END IF;

  -- sessions, IF present, must contain every required column.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'sessions'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('admin_id'),('token_hash'),('expires_at'),
                   ('created_at'),('revoked_at'),('ip_address'),('user_agent')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'sessions'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel sessions sudah ada tetapi kolom hilang: %', v_missing;
    END IF;

    -- token_hash must be UNIQUE, else token lookups are ambiguous (security bug).
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'sessions'
         AND tc.constraint_type = 'UNIQUE'
         AND kcu.column_name = 'token_hash'
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: sessions.token_hash tidak UNIQUE';
    END IF;
  END IF;

  -- login_attempts, IF present, must contain every required column.
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'login_attempts'
  ) THEN
    SELECT string_agg(c.col, ', ' ORDER BY c.col) INTO v_missing
      FROM (VALUES ('id'),('email'),('ip_address'),('success'),('attempted_at')) AS c(col)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public' AND ic.table_name = 'login_attempts'
          AND ic.column_name = c.col
     );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PREFLIGHT: tabel login_attempts sudah ada tetapi kolom hilang: %', v_missing;
    END IF;
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- 1. admins.password_hash
-- ----------------------------------------------------------------------------
-- Menyimpan hash (contoh bcrypt, 60 char). Nullable agar baris admin yang
-- sudah ada tetap valid.
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

COMMENT ON COLUMN admins.password_hash IS
  'Password hash (bcrypt). Never plaintext. NULL = login tidak diizinkan.';

-- Catatan APLIKASI (bukan SQL — wajib diimplementasikan di guard):
--   * Tolak login bila password_hash IS NULL atau string kosong/whitespace.
--     (bcrypt.compare terhadap NULL bisa melempar error; cek dulu.)
--   * Verifikasi password SELALU dengan hash; kirimkan pesan gagal yang sama
--     untuk email tak dikenal (anti user-enumeration).
--   * Nilai NULL/empty harus dianggap "belum ada kredensial", bukan password
--     kosong yang bisa lolos.

-- ----------------------------------------------------------------------------
-- 2. sessions
-- ----------------------------------------------------------------------------
-- Token sesi: token acak (crypto.randomBytes 32) dikirim ke klien; hanya
-- SHA-256 hex dari token yang disimpan (token_hash) agar leak DB tidak
-- memberi sesi aktif. Lookup dilakukan terhadap hash.
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,        -- SHA-256 hex, tepat 64 char
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,                        -- NULL = belum dicabut
  ip_address  VARCHAR(100),
  user_agent  TEXT
);

COMMENT ON TABLE sessions IS
  'Sesi admin server-side. Token asli hanya di cookie; DB simpan hash-nya.';

-- INDEKS PENUH pada admin_id (TIDAK partial). Dibutuhkan supaya lookup
-- SELURUH sesi milik admin tidak bergantung pada partial index, termasuk saat
-- ON DELETE CASCADE menghapus admin (baris revoked harus ikut ditemukan tanpa
-- seq scan).
CREATE INDEX IF NOT EXISTS idx_sessions_admin
  ON sessions(admin_id);

-- Lookup sesi aktif per admin (partial index, hanya baris hidup) — khusus
-- query "sesi aktif milik admin", bukan untuk cascade.
CREATE INDEX IF NOT EXISTS idx_sessions_admin_active
  ON sessions(admin_id)
  WHERE revoked_at IS NULL;

-- Filter masa berlaku & sweep kedaluwarsa (hanya baris hidup)
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at)
  WHERE revoked_at IS NULL;

-- Unik token_hash (lookup per token) sudah dijamin UNIQUE constraint di atas.

-- Catatan APLIKASI (bukan SQL — wajib diimplementasikan di guard):
--   * Validasi sesi WAJIB memeriksa TIGA kondisi sekaligus:
--       admins.is_active = true
--       sessions.revoked_at IS NULL
--       sessions.expires_at > now()
--     Ditolak bila salah satu gagal (401/403 sesuai kebijakan).
--   * Kebijakan expiry SLIDING + ABSOLUT tanpa kolom tambahan:
--     sliding 7 hari -> expires_at = LEAST(now()+7d, created_at+30d);
--     absolut 30 hari di-anchor ke created_at (created_at+30d > now()).
--     Tidak perlu menambah kolom baru ke tabel ini.
--   * CASCADE di atas HANYA menghapus sesi saat baris admin benar-benar
--     dihapus. Kebijakan proyek: akun TIDAK dihapus, dinonaktifkan via
--     is_active=false. Menyetel is_active=false TIDAK otomatis mencabut sesi
--     yang ada — oleh karenanya WAJIB:
--       - mencabut SELURUH sesi milik admin itu (UPDATE revoked_at = now())
--         saat admin dinonaktifkan, dan
--       - mencabut SELURUH sesi milik admin itu saat password diganti,
--         agar sesi lama tidak tetap hidup.
--     Kedua pencabutan itu = operasi UPDATE pada tabel ini (dilakukan aplikasi,
--     bukan oleh migrasi ini).

-- ----------------------------------------------------------------------------
-- 3. login_attempts
-- ----------------------------------------------------------------------------
-- Baris per percobaan login. Lockout TIDAK disimpan sebagai kolom; dihitung
-- aplikasi dari hitungan kegagalan dalam jendela waktu geser
-- (usul 4C.1: 5 gagal -> kunci 15 mnt, naik eksponensial; sukses reset).
CREATE TABLE IF NOT EXISTS login_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email        VARCHAR(255) NOT NULL,
  -- NULL = IP klien TIDAK dapat dipercaya (tidak ada proxy tepercaya yang
  -- dikonfigurasi). Baris NULL dihitung dalam bucket identity-only per email,
  -- bukan bucket bersama: satu klien tak dikenal tidak boleh bisa mengunci
  -- akun orang lain. JANGAN dinormalisasi menjadi '' (string kosong) — itu
  -- akan menggabungkan semua klien tak dikenal ke satu bucket bersama.
  ip_address   VARCHAR(100),
  success      BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE login_attempts IS
  'Riwayat percobaan login untuk rate limiting sliding window per email+IP.';

-- Hitung kegagalan per email+IP dalam jendela waktu
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_ip_time
  ON login_attempts(email, ip_address, attempted_at DESC);

-- Bucket identity-only (ip_address IS NULL): per email, bukan bucket bersama.
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_null_ip_time
  ON login_attempts(email, attempted_at DESC)
  WHERE ip_address IS NULL;

-- Pembatasan global per IP (anti spray lintas email)
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time
  ON login_attempts(ip_address, attempted_at DESC);

-- Catatan APLIKASI (bukan SQL):
--   * IP: kolom `ip_address` boleh NULL. NULL berarti "identitas klien tidak
--     dapat dipercaya" — hanya header yang dinyatakan operator lewat
--     ARCHIVE_TRUSTED_PROXY_HEADER yang dibaca; `x-forwarded-for` mentah bisa
--     dipalsukan klien dan TIDAK boleh dipercaya. Percobaan dengan IP tak
--     dikenal dihitung pada bucket identity-only per EMAIL (lihat
--     `src/lib/auth/rate-limit.ts`), sehingga tebakan tetap dibatasi tanpa
--     satu klien pernah mengunci akun orang lain.
--   * RETENSI: tabel ini tumbuh TANPA BATAS. Direncanakan prune baris
--     berumur > 30 hari (atau lebih pendek untuk baris success).
--     Penjadwalan (cron pg_cron atau job aplikasi) BELUM dibuat —
--     retensi adalah rencana yang masih perlu diatur di luar file ini.
--   * Tabel ini TIDAK punya trigger append-only; DELETE retensi diizinkan.

-- ============================================================================
-- Catatan implementasi (bukan SQL):
--   * driver: @neondatabase/serverless; hash: bcryptjs (cost ~12).
--   * cookie: HttpOnly + Secure(prod) + SameSite=Lax; CSRF via header kustom.
--   * Migrasi ini BELUM diterapkan dan BELUM divalidasi di PostgreSQL.
--   * Blok PREFLIGHT (§0) juga BELUM diuji terhadap PostgreSQL nyata.
--   * Tidak ada perubahan pada audit_logs, FK, atau data existing.
-- ============================================================================

COMMIT;
