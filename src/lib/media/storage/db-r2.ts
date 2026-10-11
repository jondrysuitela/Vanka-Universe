import "server-only";

import { getPool } from "@/lib/db";
import type { MediaQueryable } from "@/lib/media/db/repository";
import { createDbMediaStore } from "@/lib/media/storage/db-media-store";
import { createR2ObjectClient, type MediaObjectClient } from "@/lib/media/storage/object-client";
import { readR2Config, type R2Config, type S3ClientLike } from "@/lib/media/storage/r2";
import { StorageConfigError, type MediaStore } from "@/lib/media/storage/types";

/**
 * `db-r2` provider (Tahap 4G.40D-4): Postgres/Neon metadata + Cloudflare R2 bytes.
 *
 * This is the ONLY place that combines `createDbMediaStore` (metadata source of
 * truth in `media_objects`) with `createR2ObjectClient` (raw object bytes). It is
 * selected EXPLICITLY via `MEDIA_STORAGE_DRIVER=db-r2`; the default stays
 * `filesystem`, and the legacy `r2` driver (JSON index) is untouched.
 *
 * FAIL-CLOSED, no silent fallback:
 *  - R2 configuration is read through `readR2Config` -> `R2ConfigError` when
 *    incomplete/malformed.
 *  - The database pool is resolved through `getPool` -> wrapped as
 *    `StorageConfigError` when `DB_DRIVER`/`DATABASE_URL` are not configured.
 *  Neither path ever drops back to the filesystem provider.
 *
 * KEY CONSISTENCY: `config.keyPrefix` (the SAME prefix `readR2Config` normalizes,
 * default `test/` but overridden by `R2_KEY_PREFIX`) is passed to BOTH the object
 * client (which prefixes every object key) and the metadata store (which writes
 * `storage_key`). There is no second, divergent default prefix.
 *
 * No live connection is opened here: the pool and clients are created lazily and
 * never contacted during construction. Tests inject `pool`/`objects`/`client` so
 * no network or credentials are needed.
 */

export interface DbR2MediaStoreOptions {
  /** Environment to read R2 config from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Pre-built pool (tests). Defaults to `getPool()`. */
  pool?: MediaQueryable;
  /** Pre-built object client (tests). Defaults to a live R2 client. */
  objects?: MediaObjectClient;
  /** Pre-validated R2 config (tests). Defaults to `readR2Config(env)`. */
  config?: R2Config;
  /** Injected S3 surface (tests). Used only when `objects` is not supplied. */
  client?: S3ClientLike;
}

/** Resolve a database pool, translating config problems into a typed failure. */
function resolveDatabasePool(): MediaQueryable {
  try {
    return getPool();
  } catch {
    // getPool throws ONLY for missing/invalid DB_DRIVER or DATABASE_URL; the
    // message may name env vars but never a value. Keep the cause untyped but
    // fail closed as a storage configuration error.
    throw new StorageConfigError(
      "Provider media DB+R2 belum siap: konfigurasi database tidak tersedia.",
    );
  }
}

/** Reject an injected prefix that is empty or does not end with `/`. */
function assertUsablePrefix(keyPrefix: string): string {
  if (typeof keyPrefix !== "string" || keyPrefix.trim() === "" || !keyPrefix.endsWith("/")) {
    throw new StorageConfigError(
      "Provider media DB+R2 belum siap: keyPrefix R2 tidak valid.",
    );
  }
  return keyPrefix;
}

/** Build the `db-r2` `MediaStore`. Throws (fail-closed) when misconfigured. */
export function createDbR2MediaStore(options: DbR2MediaStoreOptions = {}): MediaStore {
  const config = options.config ?? readR2Config((options.env ?? process.env) as NodeJS.ProcessEnv);
  const keyPrefix = assertUsablePrefix(config.keyPrefix);

  const objects =
    options.objects ??
    createR2ObjectClient({ config, ...(options.client ? { client: options.client } : {}) });

  const pool = options.pool ?? resolveDatabasePool();

  return createDbMediaStore({
    pool,
    objects,
    keyPrefix,
    storageProvider: "r2",
  });
}
