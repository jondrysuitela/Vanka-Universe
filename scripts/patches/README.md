# `scripts/patches`

Reproducible patches for pinned dependencies that are applied automatically after
every dependency install (see the `postinstall` entry in `package.json`).

## `patch-opennext-preview-props.mjs`

| | |
| --- | --- |
| Target | `node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/load-manifest.js` |
| Adapter version | `@opennextjs/cloudflare@1.20.10` (pinned range `^1.20.10`) |
| Upstream issue | [opennextjs/opennextjs-cloudflare#1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) — `Unexpected loadManifest(/.next/server/preview-props.json) call!` |
| Upstream fix | PR [#1356](https://github.com/opennextjs/opennextjs-cloudflare/pull/1356) (open at the time of writing); PR [#1428](https://github.com/opennextjs/opennextjs-cloudflare/pull/1428) closed unmerged. No released adapter version contains the fix yet. |
| Change | Adds `preview-props` to the `.next` manifest glob: `**/{*-manifest,required-server-files,prefetch-hints}.json` → `**/{*-manifest,required-server-files,prefetch-hints,preview-props}.json` |
| Reason | The adapter inlines Next's manifests into the Worker bundle; `preview-props.json` is not matched by the glob, so Next's parse-time `getPreviewProps()` throws `Unexpected loadManifest(...)` and returns HTTP 500 for every route. |
| Verified | Phase 2D/2E (temporary copy, `wrangler dev --local`): with the glob patched the `loadManifest` error disappears and API routes answer normally. |
| Idempotent | Yes. If the glob already contains `preview-props` (script already ran, or an official fix is installed) the script does nothing. |
| Fails loudly | Yes. Missing target file, missing expected glob, or more than one occurrence → non-zero exit with an explanatory message. Never silently skips a real mismatch. |
| Not covered | This patch does **not** fix the Cache Components staged-render hang on workerd (upstream PR [#1318](https://github.com/opennextjs/opennextjs-cloudflare/pull/1318), unreleased). That blocker is handled by disabling Cache Components in `next.config.ts` for now. |

### Removal checklist (once an official release contains the fix)

1. Delete `scripts/patches/patch-opennext-preview-props.mjs` and this file (or this section).
2. Remove the `"postinstall"` script from `package.json`.
3. Run `npm ci`.

No application code, database schema, or media storage configuration is affected
by this patch.
