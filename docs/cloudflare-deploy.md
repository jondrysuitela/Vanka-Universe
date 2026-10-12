# Cloudflare Workers deploy runbook

Target: deploy Next.js 16 app as a Cloudflare Worker with
`@opennextjs/cloudflare` (adapter) + `wrangler`.

Status ringkas: **build, config, dan runtime lokal sudah terverifikasi**.
Yang belum: seluruh jalur yang butuh layanan nyata (Neon, R2) dan deploy itu
sendiri. Lihat "Known limitations" di bawah.

Recommended working directory: repo root (`D:\PROJEK CODING\Vanka-Universe`).
Use Git's full path on Windows if `git` is not on PATH:
`C:\Program Files\Git\cmd\git.exe`.

---

## 0. Prerequisites

- [ ] Node.js + npm (deps already pinned; `next` 16.4.0, `react` 19.3.0)
- [ ] Cloudflare account with Workers enabled
- [ ] Neon PostgreSQL project (production DB)
- [ ] Cloudflare R2 bucket (only needed for media upload/serving)
- [ ] `npx wrangler login` completed once on this machine

Worker plan sizing (measured, not guessed): the built Worker is
**~1.78 MB gzip** (`wrangler deploy --dry-run`), so it fits the Workers
**Free** plan (3 MB gzip limit). Static assets are 56 files under 25 MiB each.

### 0.1 Create the Neon database (Postgres)

1. Sign in at https://neon.tech and create a project (name e.g. `vanka-universe`).
   Pick the region closest to you (e.g. `aws-ap-southeast-1` / Singapore). The free
   tier is enough.
2. Open the project's **Connect** panel and copy the **pooled** connection string
   (the host contains `-pooler`). This app opens short-lived connections from a
   Worker, so the pooled endpoint is the right one.
3. Make sure the string still carries `sslmode=require` (Neon adds it by default).
   You will paste it as the `DATABASE_URL` secret in step 3.
4. Optional but recommended: create a branch/snapshot before running migrations,
   because every `db/draft_migration_*.sql` is still untested SQL.
5. Keep the default database name (`neondb`) and role.

### 0.2 Create the R2 bucket (media bytes)

1. Cloudflare dashboard -> **R2** -> **Create bucket** (e.g. `vanka-universe-media`).
2. R2 -> **Manage API tokens** -> create a token with permission
   **Object Read & Write**, scoped to that bucket.
   Copy the **Access Key ID** and **Secret Access Key** (the secret is shown once).
3. Note your **Account ID** (dashboard URL / R2 overview). It becomes
   `R2_ACCOUNT_ID`, and `R2_ENDPOINT` can be left unset: the code derives
   `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Choose `R2_KEY_PREFIX` explicitly (e.g. `media/`). It must be non-empty and
   must not contain `..` or a backslash, otherwise the store fails closed.
5. Leave the bucket private. The app streams bytes through its own API routes, so
   no public domain is needed.
6. `db-r2` also needs the `media_objects` table from the migration chain
   (step 1) - media upload stays disabled until that table exists.

---

## 1. Apply the database schema chain (REQUIRED, order matters)

The project has **no migration system**. The schema is a chain of SQL files and
every `db/draft_migration_*.sql` is still marked
`DRAFT - BELUM DIJALANKAN, BELUM DIUJI terhadap PostgreSQL`.

Apply in exactly this order:

```
db/schema.sql                                  (uuid-ossp, admins, memories, media,
                                                birthday_editions, content, audit_logs)
db/init.sql                                    (helper functions + triggers)
db/draft_migration_4c2a_auth_foundation.sql    (admins.password_hash, sessions, login_attempts)
db/draft_migration_4g26_birthday_letters.sql   (birthday_letters)
db/draft_migration_4g27_private_archive.sql    (private_archives)
db/draft_migration_4g39_archive_gallery.sql    (private_archive_media)
db/draft_migration_4g40d3b_media_objects.sql   (media_objects)
db/draft_migration_4g41_archive_access.sql     (archive_access_sessions, archive_access_attempts)
```

Each draft runs in a single transaction and fails closed via its own
`DO $preflight$` block. Do NOT run two drafts concurrently.

Preferred: the bundled runner (no `psql` needed). It applies the files in the
fixed order above, one file per transaction, stops at the first failure, and
never prints `DATABASE_URL`:

```bash
DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs
# stop after a specific step:
DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs --to 4g27
# just show the chain, no connection:
node scripts/apply-migrations.mjs --list
```

Alternative, if you do have `psql` (one file per command; each draft file
already contains `BEGIN;`/`COMMIT;`, so pass `--single-transaction` for safety):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4c2a_auth_foundation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g26_birthday_letters.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g27_private_archive.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g39_archive_gallery.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g40d3b_media_objects.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f db/draft_migration_4g41_archive_access.sql
```

No `psql` locally? Paste each file into the Neon SQL editor, one at a time, in
the same order. Take a Neon branch/snapshot first if the database already has
data.

Verification after the chain (structure, not just "no error") is described in
`db/MIGRATION_CHECKLIST.md` (Phase 3).

---

## 2. Create the owner (admin) account

```bash
# Requires DATABASE_URL + DB_DRIVER in the environment.
DB_DRIVER=neon DATABASE_URL='postgres://...' node scripts/create-owner.mjs
```

See `scripts/create-owner.mjs` for the exact flags/prompts (email, name,
password). `BCRYPT_COST` (default 12) controls hash cost.

---

## 3. Set secrets (never committed, never in wrangler.jsonc)

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
npx wrangler secret put R2_KEY_PREFIX      # IMPORTANT: empty => "test/" prefix
# Optional:
npx wrangler secret put R2_ENDPOINT
npx wrangler secret put R2_METADATA_KEY
```

For local testing, put the same names in `.dev.vars` (gitignored) instead.

Non-secret vars already live in `wrangler.jsonc`:
`NODE_ENV`, `DB_DRIVER`, `MEDIA_STORAGE_DRIVER`, `ARCHIVE_TRUSTED_PROXY_HEADER`.

---

## 4. Build and deploy

```bash
npm run cf:build        # opennextjs-cloudflare build -> .open-next/worker.js
npm run cf:preview      # local workerd preview (no Cloudflare upload)
npx wrangler deploy     # upload to Cloudflare
```

`npm run cf:preview` is the closest local stand-in for production. To exercise
real services locally, put `DATABASE_URL` and the `R2_*` values in `.dev.vars`
(gitignored) first. Note that `cf-connecting-ip` does not exist under
`wrangler dev`, so POST `/api/archive/access` answers 503 locally by design
unless you simulate that header.

`APP_ORIGIN` is optional: when unset the CSRF origin check falls back to the
request origin. Set it to the final public URL for a stricter check:

```bash
npx wrangler secret put APP_ORIGIN   # e.g. https://vanka-universe.example
```

---

## 5. Post-deploy smoke test

```
/                     200
/arsip-ibu            200
/birthday-experience  200
/memory-archive       200
/admin/login          200
/admin                307 -> /admin/login   (unauthenticated)
/api/auth/me          401 (unauthenticated)
/api/archive/access   200 {"..."}          (unlocked:false)
```

Then, with real services: log in as owner, upload an image (exercises R2 +
Postgres), open the private archive with the PIN (exercises
`ARCHIVE_TRUSTED_PROXY_HEADER`), and confirm a 307 still happens for `/admin`.

---

## Known limitations (not hidden)

1. **Cache Components are disabled** (`next.config.ts`: `cacheComponents: false`,
   `partialPrefetching: false`). This is a workaround for two upstream adapter
   defects (opennextjs-cloudflare issue #1355 / Next.js PR #1318): a missing
   `preview-props.json` manifest, and a workerd hang caused by
   `process.nextTick` being a microtask. Re-enable only after a released
   adapter/Next version contains the fix.
2. **`scripts/patches/patch-opennext-preview-props.mjs`** is applied via
   `postinstall`. It rewrites one glob string inside `node_modules`. It exits 0
   if the upstream fix is already present; remove it together with the
   `postinstall` entry once the adapter ships the fix
   (see `scripts/patches/README.md`).
3. **Incremental cache is a no-op** (`open-next.config.ts` uses
   `defineCloudflareConfig({})`, i.e. the dummy cache). Fine for correctness; add
   an R2/KV incremental cache later if caching is needed.
4. **Neon driver is the stateless HTTP driver.** `src/lib/db.ts` uses
   `neon()`, which sends every query as an independent HTTPS request: no
   WebSocket and nothing that outlives a request. This was verified on the
   deployed Worker (sequential and parallel reads and writes, zero hangs).
   A module-level `Pool` over WebSocket must NOT be reintroduced: on Workers the
   runtime tears down the previous request's I/O and the next query hangs
   ("your Worker's code had hung"). Every query is a single statement, so no
   transaction spans two `query()` calls; if a transaction is ever needed it
   must use `sql.transaction()` (Neon's HTTP transaction) or a different driver.
5. **`MEDIA_STORAGE_DRIVER` empty is not fail-closed.** An empty value selects
   `filesystem` (`node:fs`), which is not valid on Workers. It is set explicitly
   in `wrangler.jsonc`. Do not remove it.
6. **`R2_KEY_PREFIX` empty defaults to `test/`** (`src/lib/media/storage/r2.ts`).
   Set it explicitly for production.
7. **Private archive PIN requires `ARCHIVE_TRUSTED_PROXY_HEADER`.** When the IP
   cannot be resolved, POST `/api/archive/access` fails closed with
   `503 ARCHIVE_ACCESS_UNAVAILABLE` by design. On Cloudflare the value is
   `cf-connecting-ip`. Note this header is NOT present under local
   `wrangler dev` unless simulated.
8. **Migrations are unverified against real PostgreSQL** (see step 1). The chain
   may still contain a defect that only surfaces when executed.
