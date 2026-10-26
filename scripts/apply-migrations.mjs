#!/usr/bin/env node
/**
 * Apply the Vanka Universe schema chain to a PostgreSQL / Neon database.
 *
 * The project has no migration system: the schema is a fixed, ordered list of
 * SQL files (see docs/deploy.md). This runner exists because plain
 * `psql` is not always available (e.g. on this Windows machine) and because
 * every draft file must run in exactly one transaction.
 *
 * Usage:
 *   DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs
 *   DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs --to 4g27
 *   DATABASE_URL='postgres://...' node scripts/apply-migrations.mjs --from 4g39 --to 4g46
 *   node scripts/apply-migrations.mjs --list
 *
 * Behaviour:
 *   - Reads DATABASE_URL from the environment. It is NEVER printed or logged.
 *   - Applies files in the fixed order below, one file per transaction
 *     (the draft files also contain their own BEGIN;/COMMIT;).
 *   - Stops at the first failure and exits non-zero. Fails closed: a file that
 *     fails is rolled back, later files are not attempted.
 *   - The files are the source of truth; nothing here rewrites SQL.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DB_DIR = fileURLToPath(new URL("../db/", import.meta.url));

/** Fixed apply order. The `key` is what `--to <key>` matches. */
const CHAIN = [
  { key: "schema", file: "schema.sql" },
  { key: "init", file: "init.sql" },
  { key: "4c2a", file: "draft_migration_4c2a_auth_foundation.sql" },
  { key: "4g26", file: "draft_migration_4g26_birthday_letters.sql" },
  { key: "4g27", file: "draft_migration_4g27_private_archive.sql" },
  { key: "4g39", file: "draft_migration_4g39_archive_gallery.sql" },
  { key: "4g40d3b", file: "draft_migration_4g40d3b_media_objects.sql" },
  { key: "4g41", file: "draft_migration_4g41_archive_access.sql" },
  { key: "4g46", file: "draft_migration_4g46_birthday_music.sql" },
];

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const toIndex = args.indexOf("--to");
const toKey = toIndex === -1 ? null : args[toIndex + 1];
const fromIndex = args.indexOf("--from");
const fromKey = fromIndex === -1 ? null : args[fromIndex + 1];

if (listOnly) {
  for (const [i, step] of CHAIN.entries()) {
    const full = path.join(DB_DIR, step.file);
    const size = existsSync(full) ? readFileSync(full).length : -1;
    console.log(`${i + 1}. ${step.file} (${step.key}) ${size >= 0 ? `${size} bytes` : "MISSING"}`);
  }
  process.exit(0);
}

if (toKey !== null && !CHAIN.some((s) => s.key === toKey)) {
  console.error(`Unknown --to key "${toKey}". Valid keys: ${CHAIN.map((s) => s.key).join(", ")}`);
  process.exit(2);
}
if (fromKey !== null && !CHAIN.some((s) => s.key === fromKey)) {
  console.error(`Unknown --from key "${fromKey}". Valid keys: ${CHAIN.map((s) => s.key).join(", ")}`);
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString || connectionString.trim() === "") {
  console.error("DATABASE_URL is not set. Set it in the environment (never commit it).");
  process.exit(2);
}

const startIndex = fromKey === null ? 0 : CHAIN.findIndex((s) => s.key === fromKey);
const endIndex = toKey === null ? CHAIN.length : CHAIN.findIndex((s) => s.key === toKey) + 1;
if (startIndex > endIndex - 1) {
  console.error(`--from (${fromKey}) comes after --to (${toKey}); nothing to do.`);
  process.exit(2);
}
const steps = CHAIN.slice(startIndex, endIndex);
for (const step of steps) {
  const full = path.join(DB_DIR, step.file);
  if (!existsSync(full)) {
    console.error(`Missing SQL file: db/${step.file}`);
    process.exit(2);
  }
}

// Neon (and most hosted Postgres) require TLS. Local PostgreSQL usually does not.
const needsSsl = /neon\.tech|sslmode=require|supabase\.co|render\.com|amazonaws\.com/.test(connectionString);
const client = new pg.Client({
  connectionString,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

let applied = 0;
try {
  await client.connect();
  for (const step of steps) {
    const sql = readFileSync(path.join(DB_DIR, step.file), "utf8");
    process.stdout.write(`applying db/${step.file} ... `);
    try {
      // node-postgres uses the simple query protocol here, so a multi-statement
      // file is executed as one implicit batch inside its own BEGIN/COMMIT.
      await client.query(sql);
      applied += 1;
      console.log("ok");
    } catch (error) {
      console.log("FAILED");
      console.error(`\ndb/${step.file} failed and was rolled back: ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }
} catch (error) {
  console.error(`Could not connect to the database: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

if (applied === steps.length && process.exitCode !== 1) {
  console.log(`\nDone. ${applied}/${steps.length} file(s) applied.`);
  console.log("Next: verify structure with db/MIGRATION_CHECKLIST.md (Phase 3), then run scripts/create-owner.mjs.");
}
