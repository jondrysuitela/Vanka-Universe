# 4G.40D-2 — R2 storage adapter (design + limitations)

Status: implemented, unit-tested with a mocked S3 client. **No live R2 access.**
Not yet wired to any running environment. Default provider stays `filesystem`.

## What exists

- `src/lib/media/storage/types.ts` — `MediaStore` contract (4G.40C).
- `src/lib/media/storage/mime.ts` — shared `MIME_MAP` + `sniffMime` (extracted so
  filesystem and R2 can never disagree).
- `src/lib/media/storage/filesystem.ts` — default provider, unchanged behavior.
- `src/lib/media/storage/r2.ts` — this adapter.
- `src/lib/media/storage/index.ts` — provider selection.
- `src/lib/media/storage/__tests__/{provider,r2}.test.ts` — mocked tests.

## Configuration (server-side env only)

| name | required | default |
|---|---|---|
| `MEDIA_STORAGE_DRIVER` | no | `filesystem` (`filesystem` \| `r2` \| `db-r2`) |
| `R2_ACCOUNT_ID` | when driver=`r2` or `db-r2` | — |
| `R2_ACCESS_KEY_ID` | when driver=`r2` or `db-r2` | — |
| `R2_SECRET_ACCESS_KEY` | when driver=`r2` or `db-r2` | — |
| `R2_BUCKET` | when driver=`r2` or `db-r2` | — |
| `R2_ENDPOINT` | no | `https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com` |
| `R2_KEY_PREFIX` | no | `test/` |
| `R2_METADATA_KEY` | no | `<keyPrefix>index.json` |

Values are never logged. Missing/malformed config raises `R2ConfigError`
(fail-closed; never a filesystem fallback).

## Keys

- Media object: `${R2_KEY_PREFIX}${uuid}.${ext}` — UUID validated, `ext` derived
  from the server-sniffed MIME. Object keys are server-generated and never
  returned to clients.
- Metadata index: separate object (`test/index.json` by default).
  `readR2Config` refuses a metadata key whose basename looks like a media key,
  so the index can never collide with media.
- Path traversal (`..`, `\`, leading `/`) is rejected in prefix and metadata key.

## Failure semantics (documented compensating actions)

R2 has **no multi-object transaction**. Ordering is chosen so the visible
metadata never references bytes that do not exist.

`save`:
1. `PutObject` media.
2. index read-modify-write (add record).
- If the index write fails, compensating action: `DeleteObject` the media.
- If cleanup also fails → `R2IntegrityError`; a media object may remain
  orphaned (bytes present, not referenced) — this is the honest residual, not a
  silent success.

`remove`:

1. remove the index entry (`PutObject` index),
2. then `DeleteObject` the object.

If step 2 fails (and it is not a genuine 404), the index entry is restored so
metadata matches the still-present object; the original error is re-thrown. If
the restore ALSO fails, an `R2IntegrityError` is raised instead of hiding it.
A missing object is treated as a successful delete (idempotent), matching the
filesystem's ENOENT handling.

Index errors: a MISSING index object = legitimate empty list; a malformed index
raises `R2IndexError{code: INDEX_CORRUPT}`. A missing bucket is NOT treated as
empty (fail-closed).

## Concurrency limitation (review required)

Index mutations are serialized **within one Node process** with a promise chain
(mirrors the filesystem provider). This cannot protect two processes/instances
mutating the same index object concurrently — a lost-update window remains.
Cross-process safety was intentionally NOT faked (no unverified conditional
writes). Treat this as an open item: if the deployment ever allows more than one
writer to the same R2 prefix, replace the read-modify-write index with a
concurrency-safe primitive (per-record object keys + ETag/If-Match, or a single
writer).

## Not done in this phase

- No credentials configured; no live R2 request.
- No `.env.local` / runtime change; default provider still filesystem.
- Filesystem behavior, proxy authorization, reference protection, and Range
  handling in the existing routes are untouched.
