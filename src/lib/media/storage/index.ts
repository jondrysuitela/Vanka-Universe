import { createDbR2MediaStore } from "@/lib/media/storage/db-r2";
import { filesystemMediaStore } from "@/lib/media/storage/filesystem";
import { createR2MediaStore } from "@/lib/media/storage/r2";
import { StorageConfigError, type MediaStore } from "@/lib/media/storage/types";

/**
 * Media storage provider selection (Tahap 4G.40C, extended 4G.40D-2 / 4G.40D-4).
 *
 * `MEDIA_STORAGE_DRIVER` selects the provider. Absent/empty defaults to
 * `filesystem` (the current production behavior). An UNKNOWN value FAILS CLOSED
 * with a typed `StorageConfigError` — it never silently falls back to another
 * provider.
 *
 * `r2`    — legacy R2 store with a JSON metadata index (unchanged behavior).
 * `db-r2` — Postgres/Neon metadata (`media_objects`) + R2 bytes (4G.40D-4).
 *           Requires DB_DRIVER/DATABASE_URL AND complete R2 configuration;
 *           missing/malformed configuration FAILS CLOSED (`StorageConfigError`
 *           or `R2ConfigError`) — never a fallback to filesystem.
 */

export const MEDIA_STORAGE_DRIVERS = ["filesystem", "r2", "db-r2"] as const;
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];

/** Resolve the configured driver; throws `StorageConfigError` when invalid. */
export function resolveMediaStorageDriver(): MediaStorageDriver {
  const raw = process.env.MEDIA_STORAGE_DRIVER;
  if (raw === undefined || raw.trim() === "") return "filesystem";
  if ((MEDIA_STORAGE_DRIVERS as readonly string[]).includes(raw)) {
    return raw as MediaStorageDriver;
  }
  throw new StorageConfigError(
    `Invalid or unsupported MEDIA_STORAGE_DRIVER "${raw}". ` +
      `Supported values: ${MEDIA_STORAGE_DRIVERS.join(", ")}.`,
  );
}

/** Return the selected provider. Throws for an invalid/unsupported driver. */
export function getMediaStore(): MediaStore {
  switch (resolveMediaStorageDriver()) {
    case "filesystem":
      return filesystemMediaStore;
    case "r2":
      // Throws R2ConfigError when R2 is not fully configured — no fallback.
      return createR2MediaStore();
    case "db-r2":
      // Throws R2ConfigError / StorageConfigError when DB or R2 config is
      // incomplete — no fallback to filesystem.
      return createDbR2MediaStore();
    default:
      // Unreachable: resolveMediaStorageDriver already rejects unknown values.
      throw new StorageConfigError("Unsupported media storage configuration.");
  }
}
