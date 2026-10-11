# 4G.39D — Migration & E2E Runbook (Arsip Ibu gallery)

**Status: PREPARED, NOT EXECUTED.** No migration has been run against Neon.

Target object: `public.private_archive_media` (draft
`db/draft_migration_4g39_archive_gallery.sql`).

## 0. Preconditions (verified 4G.39D-preflight, read-only)
- Neon `neondb` / schema `public`, `DB_DRIVER=neon`.
- `uuid-ossp` extension present; `update_updated_at_column()` present.
- `private_archives` exists (draft 4g27 applied), `media` exists (unused, 0 rows).
- `private_archive_media` **absent** → apply required.
- Local `storage/media/` absent → upload controlled test media before E2E.

Re-check anytime (read-only):
```sql
select extname from pg_extension where extname='uuid-ossp';
select to_regclass('public.private_archives'), to_regclass('public.media');
select to_regclass('public.private_archive_media');   -- NULL = not applied
```

## 1. Apply (single transaction)
The file already contains `BEGIN; … COMMIT;` and a preflight `DO` block that
aborts (⇒ full rollback) if prerequisites are missing.

**Transport note:** Neon's serverless HTTP driver runs one statement per implicit
transaction and **cannot** run this file. Use psql over TCP or the Neon SQL
Editor (SQL editor runs the selected text as one transaction).

```bash
# Do NOT echo the connection string to any log.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/draft_migration_4g39_archive_gallery.sql
```

Neon SQL Editor: paste the entire file and run once (the file's `BEGIN/COMMIT`
keeps it atomic).

## 1.1 Verify structure (catalog must prove it — do not assume)
```sql
select to_regclass('public.private_archive_media');

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='private_archive_media'
 order by ordinal_position;
-- expect: id, archive_id, media_id, role, title, description,
--         memory_date, position, created_at, updated_at

select conname, pg_get_constraintdef(oid)
  from pg_constraint where conrelid='public.private_archive_media'::regclass
 order by conname;
-- expect: pk, uq(archive_id,media_id), chk role intro|photo,
--         chk position>=0, fk archive_id -> private_archives ON DELETE CASCADE

select indexname from pg_indexes
 where schemaname='public' and tablename='private_archive_media'
 order by indexname;
-- expect: pkey, uq_private_archive_media_media, uq_private_archive_media_intro,
--         idx_private_archive_media_role?/position, idx_private_archive_media_media

select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relname='private_archive_media' and not t.tgisinternal;
-- expect: trg_private_archive_media_updated_at

select count(*) from public.private_archive_media;  -- expect 0
```

## 1b. Confirm existing data untouched
```sql
select count(*) from public.media;                    -- unchanged (0)
select slug, status from public.private_archives;     -- unchanged
```

## 2. Failure handling
- The file is a single transaction; a failure applies **nothing**.
- Detect a failed/partial apply: `to_regclass('public.private_archive_media') IS NULL`.
- Re-run the file: `IF NOT EXISTS` guards objects; the preflight rejects a
  pre-existing conflicting table (missing columns or missing FK). If a foreign
  `private_archive_media` exists, resolve manually — do not force.
- Transport note again: **do not** apply via the app's `neon()` HTTP driver.

## 3. Rollback (DESTRUCTIVE once gallery content exists — needs approval)
```sql
BEGIN;
DROP TABLE IF EXISTS public.private_archive_media;
COMMIT;
```
Removes only the new table (and any gallery rows). `private_archives` and all
media **files** are never touched. Not "safe" once real gallery rows exist —
those rows are lost (re-enterable, not DB-recoverable). Take a Neon branch or
snapshot first.

## 4. Recommended: use a Neon branch
Point the dev server at a branch database so the production singleton archive
`tentang-ibumu` is never touched by E2E.

## 5. DB round-trip / API E2E (script)
`scripts/archive-gallery-e2e.mjs` (HTTP only; refuses to write without opt-in;
restores the baseline gallery it read first).

```powershell
# Server must point at the target DB (branch preferred).
$env:VANKA_ALLOW_TEST_WRITES="1"
$env:VANKA_BASE_URL="http://localhost:3000"
$env:VANKA_ADMIN_EMAIL="you@example.com"
$env:VANKA_ADMIN_PASSWORD="<password>"      # not printed
$env:VANKA_PHOTO_MEDIA_IDS="<img-uuid>,<img-uuid>"
$env:VANKA_INTRO_MEDIA_ID="<video-uuid>"
& "$env:ProgramFiles\nodejs\node.exe" scripts/archive-gallery-e2e.mjs
```

Covered: PUT→GET intro + 2 photos (titles, individual descriptions, memory
date), order persistence, reorder persistence, duplicate photo → 422, unknown
id → 422, video-as-photo → 422, missing CSRF header → 403, unauthenticated
GET/PUT → 401. With `VANKA_PHOTO_MEDIA_IDS` unset it lists available media and
exits **without writing**.

Prerequisite: upload controlled test media via `/admin/media` (writes the local
store only) — OR, if only the production DB is available, obtain explicit
approval before uploading/overwriting anything.

## 6. Browser E2E (manual, real browser)
With the migration applied and the server running:
1. Log in as an operator, open `/admin/archive/experience`.
2. Verify: chosen intro video autoplays muted **or** shows the "Putar video"
   overlay; letting it finish fires the real `ended` event and reveals the
   gallery. Reload and use **"Lewati video"** → gallery.
3. Simulate a failed video (e.g., DevTools block `/api/media/<intro-id>`) →
   amber "Video pembuka gagal dimuat" panel **and** the gallery still works.
4. Verify each Polaroid shows the DB `title` + individual `description` +
   optional `memory_date`, in stored order. Click a photo → lightbox; `Esc` closes.
5. Emulate `prefers-reduced-motion: reduce` → no transform animation.
6. Unauthenticated: open `/admin/archive/experience` in a fresh session → denied
   by the `(protected)` layout.
7. Before the migration (current state), confirm the page shows
   **"Galeri belum diaktifkan"** and never an empty saved gallery.
8. Regression: login works; old `PUT /api/archive` works; `/admin/media`
   upload/list works; media DELETE stays fail-closed.

## 7. Cleanup
- The script restores the baseline gallery automatically.
- Manual reset (only if you created the test gallery): `PUT /api/archive/gallery`
  with `{ "introMediaId": null, "photos": [] }` — removes gallery rows only.
- Never delete media files that are referenced; with the new probe registered,
  DELETE of referenced media returns `409 CONFLICT`.

## 8. Open approvals
1. Apply `4g39` to Neon (branch preferred).
2. Register + deploy the gallery media-reference probe (done in code, 4G.39D).
3. Approval to upload controlled fixtures / write the singleton if no branch.
