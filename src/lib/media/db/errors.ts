/**
 * Typed errors for the database-backed media metadata (Tahap 4G.40D-3B).
 *
 * All are FAIL-CLOSED: they exist so a half-finished state is never mistaken
 * for a healthy one, and so the caller can distinguish a real, typed failure
 * from an unexpected crash.
 */

/**
 * The `media_objects` table is missing (PostgreSQL 42P01). Raised instead of
 * returning an empty list, which would otherwise look like "the archive is
 * genuinely empty" after a failed/missing migration.
 */
export class MediaObjectsUnavailableError extends Error {
  constructor() {
    super("Tabel metadata media belum tersedia (migrasi 4g40d3b belum dijalankan).");
    this.name = "MediaObjectsUnavailableError";
  }
}

/**
 * An operation could not return the bucket/table to a consistent state, even
 * after the compensating action. The message must stay free of object keys,
 * file paths, and credentials.
 */
export class MediaMetadataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaMetadataIntegrityError";
  }
}

/** True for PostgreSQL `undefined_table` (42P01). */
export function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42P01"
  );
}
