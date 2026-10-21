# Migration Readiness Checklist — Auth Foundation (4C.2a)

**Status:** Preparation only. No database changes performed. This checklist is run AFTER `db/schema.sql`, `db/init.sql`, and `db/draft_migration_4c2a_auth_foundation.sql` have been applied to a local PostgreSQL instance to verify compatibility with code and identify any drift or failures.

---

## Scope of the migration chain

This checklist originated for the **auth** draft (4C.2a). The planned chain now contains **three**
draft migrations. Apply them in this order, after `db/schema.sql` and `db/init.sql`:

| Order | Draft | Table(s) / change | Detailed verification & rollback |
|---|---|---|---|
| 3 | `db/draft_migration_4c2a_auth_foundation.sql` | `admins.password_hash`, `sessions`, `login_attempts` | **This checklist** (Phases 1–5) |
| 4 | `db/draft_migration_4g26_birthday_letters.sql` | `birthday_letters` | `db/BIRTHDAY_PERSISTENCE_PLAN.md` (§14 verification, rollback) |
| 5 | `db/draft_migration_4g27_private_archive.sql` | `private_archives` + additive widening of `media.chk_media_type` (`audio`) | `db/PRIVATE_ARCHIVE_SCHEMA_PLAN.md` (§6–§7) |

Phases 1–5 below cover the **auth** draft in detail. The detailed verification and rollback steps for
the **birthday** and **archive** drafts remain in their individual plan documents listed above; this
checklist does not duplicate them. Every prerequisite and drift note here applies equally to all
drafts (each draft runs in one transaction and fails closed via its own `DO $preflight$` block).

---

## Phase 0: Fresh install vs upgrade

Decide the path **before** running anything. The migration is **additive** and never deletes or
rewrites existing data.

- **FRESH install** (empty database): apply `db/schema.sql` → `db/init.sql` →
  `db/draft_migration_4c2a_auth_foundation.sql`.
- **UPGRADE** (database already has `schema.sql`): apply only the draft migration.

The draft runs inside **one transaction** and starts with a **PREFLIGHT** block (`DO $preflight$`)
that `RAISE EXCEPTION` (⇒ rollback, no DDL applied) when it detects: missing `uuid-ossp`, missing
`admins`, `admins.email` not UNIQUE, `admins.password_hash` present but not `text`, missing
required columns in an existing `sessions`/`login_attempts`, or `sessions.token_hash` not UNIQUE.

**Backup expectation:** take a snapshot / Neon branch before running on a database that holds data.
Do **not** rely on manual `DROP` rollback (Phase 5) — it is destructive and not automatic.

> **UNVERIFIED:** the PREFLIGHT block and the whole migration have **not** been executed against a
> real PostgreSQL server. "No error" is not proof the resulting structure is correct — Phase 3
> verification is mandatory.

---

## Phase 1: Pre-Migration Verification

Before running the migration, confirm prerequisites:

- [ ] PostgreSQL server running locally (`psql` available on PATH or via full path)
- [ ] Database created and reachable (test: `psql -c "SELECT version();"`)
- [ ] `db/schema.sql` successfully applied (has `admins`, `memories`, `media`, `birthday_editions`, `content`, `audit_logs`)
- [ ] `db/init.sql` successfully applied (has triggers `trg_admins_updated_at` etc., functions `update_updated_at_column` and `audit_logs_no_mod`)
- [ ] Extension `uuid-ossp` present: `psql -c "SELECT * FROM pg_extension WHERE extname='uuid-ossp';"`
- [ ] Current admins table has columns: `id, email, name, role, is_active, last_login_at, created_at, updated_at`
- [ ] No row in admins has a `password_hash` column yet (will fail if already added with wrong type)

---

## Phase 2: Migration Application

Execute the draft migration in a single transaction:

```bash
psql --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql
```

**Expected behavior:**
- No errors; all statements succeed or entire transaction rolls back if any statement fails.
- Three main changes: add `admins.password_hash`, create `sessions` table, create `login_attempts` table.

---

## Phase 3: Information Schema Verification

After migration completes, verify the following using `information_schema` and `pg_indexes` queries. These queries detect drift (e.g., if `IF NOT EXISTS` concealed a pre-existing object with incompatible definition).

### 3.1 admins.password_hash Column

**Query:**
```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'admins' AND column_name = 'password_hash';
```

**Expected result:**
| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| password_hash | text | YES | NULL |

**Failure modes:**
- No rows: column does not exist; migration did not run or `IF NOT EXISTS` concealed a prior failure.
- `data_type` is not `text`: schema mismatch (must store 60-char bcrypt hash).
- `is_nullable` is `NO`: contradicts migration intent (existing rows have NULL).

---

### 3.2 sessions Table Columns

**Query:**
```sql
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'sessions'
 ORDER BY ordinal_position;
```

**Expected result:**
| column_name | data_type | character_maximum_length | is_nullable | column_default |
|---|---|---|---|---|
| id | uuid | NULL | NO | uuid_generate_v4() |
| admin_id | uuid | NULL | NO | NULL |
| token_hash | character varying | 64 | NO | NULL |
| expires_at | timestamp with time zone | NULL | NO | NULL |
| created_at | timestamp with time zone | NULL | NO | now() |
| revoked_at | timestamp with time zone | NULL | YES | NULL |
| ip_address | character varying | 100 | YES | NULL |
| user_agent | text | NULL | YES | NULL |

**Failure modes:**
- Table does not exist (zero rows): `CREATE TABLE IF NOT EXISTS` concealed prior failure or migration was not run.
- Columns missing: partial creation (drift detection failure).
- `created_at` type is not `timestamp with time zone`: will break absolute expiry check in code (`s.created_at + interval '30 days' > now()`).
- `token_hash` length is not 64: SHA-256 hex must be exactly 64 characters; lookups will fail.

---

### 3.3 sessions Foreign Key Constraint

**Query:**
```sql
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
   AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints AS rc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.table_schema
 WHERE tc.table_schema = 'public'
   AND tc.table_name = 'sessions'
   AND tc.constraint_type = 'FOREIGN KEY';
```

**Expected result:**
| constraint_name | table_name | column_name | foreign_table_name | foreign_column_name | delete_rule |
|---|---|---|---|---|---|
| sessions_admin_id_fkey | sessions | admin_id | admins | id | CASCADE |

**Failure modes:**
- No rows: FK constraint does not exist; `ALTER TABLE` for FK failed.
- `delete_rule` is not `CASCADE`: deleting an admin won't clean up sessions (code avoids deletes, but constraint drift is a mismatch).

---

### 3.4 sessions Unique Constraint on token_hash

**Query:**
```sql
SELECT tc.constraint_name, kcu.column_name
  FROM information_schema.table_constraints AS tc
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
 WHERE tc.table_schema = 'public'
   AND tc.table_name = 'sessions'
   AND tc.constraint_type = 'UNIQUE'
   AND kcu.column_name = 'token_hash';
```

**Expected result:** At least one row with `constraint_type='UNIQUE'` and `column_name='token_hash'`.

**Failure modes:**
- No rows: token lookups are not unique; multiple rows could match one token (security bug).

---

### 3.5 sessions Indexes

**Query:**
```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'sessions'
 ORDER BY indexname;
```

**Expected indexes:**
1. `idx_sessions_admin`: `CREATE INDEX idx_sessions_admin ON public.sessions USING btree (admin_id)`
2. `idx_sessions_admin_active`: `CREATE INDEX idx_sessions_admin_active ON public.sessions USING btree (admin_id) WHERE (revoked_at IS NULL)`
3. `idx_sessions_expires_at`: `CREATE INDEX idx_sessions_expires_at ON public.sessions USING btree (expires_at) WHERE (revoked_at IS NULL)`

**Failure modes:**
- Indexes missing: queries slow or ON DELETE CASCADE on admin must do seq scan.
- Partial condition wrong: may use wrong predicate for live-session queries; performance degraded.

---

### 3.6 login_attempts Table Columns

**Query:**
```sql
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'login_attempts'
 ORDER BY ordinal_position;
```

**Expected result:**
| column_name | data_type | character_maximum_length | is_nullable | column_default |
|---|---|---|---|---|
| id | uuid | NULL | NO | uuid_generate_v4() |
| email | character varying | 255 | NO | NULL |
| ip_address | character varying | 100 | **YES** | NULL |
| success | boolean | NULL | NO | false |
| attempted_at | timestamp with time zone | NULL | NO | now() |

**Failure modes:**
- Table does not exist (zero rows): `CREATE TABLE` failed.
- Columns missing or types wrong: queries in `rate-limit.ts` will fail or return wrong data.
- `ip_address.is_nullable` is `NO`: the identity-only bucket (`ip_address IS NULL`) cannot be
  written, so a login attempt from an untrusted/unknown client IP would fail with a NOT NULL
  violation and the rate limiter would never record that attempt.

---

### 3.7 login_attempts Indexes

**Query:**
```sql
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'login_attempts'
 ORDER BY indexname;
```

**Expected indexes:**
1. `idx_login_attempts_email_ip_time`: `CREATE INDEX idx_login_attempts_email_ip_time ON public.login_attempts USING btree (email, ip_address, attempted_at DESC)`
2. `idx_login_attempts_email_null_ip_time`: `CREATE INDEX idx_login_attempts_email_null_ip_time ON public.login_attempts USING btree (email, attempted_at DESC) WHERE (ip_address IS NULL)`
3. `idx_login_attempts_ip_time`: `CREATE INDEX idx_login_attempts_ip_time ON public.login_attempts USING btree (ip_address, attempted_at DESC)`

**Failure modes:**
- Indexes missing: rate-limit queries degrade to seq scans; high concurrency risk.
- Column order wrong: index not used; queries slow.
- `idx_login_attempts_email_null_ip_time` missing: the identity-only bucket query degrades to a
  seq scan; correctness is unaffected.

---

## Phase 4: Operational Verification

After schema is confirmed:

- [ ] Run `scripts/create-owner.mjs <email> <name>` successfully (prompts for password, inserts owner, exits 0)
- [ ] New admin row present in DB: `SELECT email, role, is_active FROM admins WHERE role='owner' AND email='<email>';`
- [ ] `password_hash` field populated (60 chars, starts with `$2a` or `$2b`): `SELECT length(password_hash), substr(password_hash,1,3) FROM admins WHERE role='owner';`
- [ ] Create `.env.local` with `DB_DRIVER=pg` and `DATABASE_URL=postgres://...` pointing to local PostgreSQL
- [ ] Restart dev server (or ensure it picks up `.env.local` changes)
- [ ] POST `/api/auth/login` with correct email+password → 200 with `Set-Cookie: vanka_session`
- [ ] GET `/api/auth/me` with session cookie → 200, returns admin record
- [ ] POST `/api/auth/logout` → 200, session cookie cleared
- [ ] Rate limit: 6 failed logins within 15 minutes same email+IP → next login returns 429 RATE_LIMITED
- [ ] Revoke session: `UPDATE sessions SET revoked_at = now() WHERE admin_id = '<id>';` then GET `/api/auth/me` → 401

---

## Phase 5: Rollback (if migration fails or verification fails)

If migration fails at any step or verification finds drift:

1. Entire migration rolled back automatically (single transaction via `--single-transaction`).
2. Schema reverted to state before migration.
3. Manual rollback of applied migration is not needed if using psql --single-transaction.

If manual rollback needed (migration succeeded but verification failed):

> **DESTRUCTIVE / ONE-WAY.** This drops the `sessions` table (with `CASCADE`), `login_attempts`,
> and the `admins.password_hash` column — losing any session/login data. There is no version/history
> table, so a partial re-run cannot be detected automatically. Requires explicit owner approval.

```sql
BEGIN;
ALTER TABLE admins DROP COLUMN IF EXISTS password_hash;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS login_attempts;
COMMIT;
```

---

## Notes & Limitations

- `IF NOT EXISTS` in migration hides pre-existing definitions. Post-migration verification via `information_schema` is necessary to detect drift (e.g., wrong column type on `password_hash` if column existed before with incompatible type).
- No version/history tracking yet; re-running migration is unsafe if prior run partially succeeded outside a transaction.
- `login_attempts` table has no retention policy (grows unbounded). Prune old rows separately (deferred to future maintenance task).
- `audit_logs` not modified; admin creation cannot be audited until `chk_audit_entity` constraint is expanded (pending schema change, not part of this migration).
- Script `create-owner.mjs` uses TTY raw mode for password masking; fallback to non-TTY stdin if raw mode unavailable. **Not empirically tested on Windows** — operator must verify password masking works or use stdin redirect.
