#!/usr/bin/env node
/**
 * Reproducible dependency patch for @opennextjs/cloudflare (pinned ^1.20.10).
 *
 * Upstream bug
 *   https://github.com/opennextjs/opennextjs-cloudflare/issues/1355
 *   `Unexpected loadManifest(/.next/server/preview-props.json) call!` — every
 *   request returns 500 because `.next/server/preview-props.json` is not inlined
 *   into the bundle's manifest map.
 *
 * Minimal fix (matches upstream PR #1356 / #1428 intent)
 *   The adapter's manifest glob in
 *   `dist/cli/build/patches/plugins/load-manifest.js` omits `preview-props`,
 *   so Next's `getPreviewProps()` parse-time manifest lookup fails at runtime.
 *   Add `preview-props` to that one glob. Nothing else is changed.
 *
 * Why a script instead of editing node_modules by hand
 *   `npm ci` deletes and recreates node_modules, so a manual edit does not
 *   survive a clean install. This script runs from the `postinstall` hook and
 *   re-applies the same one-line change every time dependencies are installed.
 *
 * Removal (once an official release contains the fix)
 *   1. Delete this file and `scripts/patches/README.md`.
 *   2. Delete the `postinstall` entry from package.json.
 *   3. Run `npm ci`.
 *   If the installed adapter already contains `preview-props` in the glob, this
 *   script exits 0 without touching anything, so it is safe to keep until then.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TARGET = path.join(
  "node_modules",
  "@opennextjs",
  "cloudflare",
  "dist",
  "cli",
  "build",
  "patches",
  "plugins",
  "load-manifest.js",
);

const OLD_GLOB = "**/{*-manifest,required-server-files,prefetch-hints}.json";
const NEW_GLOB = "**/{*-manifest,required-server-files,prefetch-hints,preview-props}.json";

const log = (message) => console.log(`[patch-opennext-preview-props] ${message}`);
const fail = (message) => {
  console.error(`[patch-opennext-preview-props] ERROR: ${message}`);
  process.exit(1);
};

if (!existsSync(TARGET)) {
  fail(
    `cannot find ${TARGET}. Run this hook after dependencies are installed, or update the path for the installed @opennextjs/cloudflare version.`,
  );
}

const source = readFileSync(TARGET, "utf8");

// Already containing `preview-props` means either this script already ran or an
// official adapter release shipped the fix. Either way, do nothing.
if (source.includes("preview-props")) {
  log("glob already includes preview-props; nothing to do.");
  process.exit(0);
}

const occurrences = source.split(OLD_GLOB).length - 1;

if (occurrences === 0) {
  fail(
    `expected glob "${OLD_GLOB}" was not found in ${TARGET}. The adapter source changed; review whether the official fix is available and remove this patch.`,
  );
}

if (occurrences !== 1) {
  fail(`expected exactly 1 occurrence of the glob in ${TARGET}, found ${occurrences}. Refusing to patch.`);
}

writeFileSync(TARGET, source.replace(OLD_GLOB, NEW_GLOB), "utf8");
log(`added preview-props to the manifest glob in ${TARGET}.`);
