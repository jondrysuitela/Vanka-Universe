/**
 * Typed FAIL-CLOSED errors for the private-archive VISITOR access
 * (Tahap VU-ARCHIVE-ACCESS-3A).
 *
 * A half-configured or un-migrated archive must never be mistaken for an open
 * one. Every error message stays free of credentials, hashes, and PIN values.
 */

/**
 * The visitor-access tables/columns are missing — the additive migration has
 * not been applied (PostgreSQL 42P01, or a prerequisite table is absent).
 * Raised instead of silently allowing or denying without a reason.
 */
export class ArchiveAccessUnavailableError extends Error {
  constructor() {
    super("Akses arsip belum tersedia (migrasi access belum dijalankan).");
    this.name = "ArchiveAccessUnavailableError";
  }
}

/**
 * The archive explicitly refuses visitor access: no PIN is configured, or
 * visitor access is disabled. Access is denied until an operator enables it.
 */
export class ArchiveAccessDisabledError extends Error {
  constructor() {
    super("Akses arsip belum diaktifkan.");
    this.name = "ArchiveAccessDisabledError";
  }
}

/**
 * No trustworthy client identity is available for rate limiting (Tahap
 * VU-ARCHIVE-ACCESS-3D). The archive gate fails CLOSED instead of bucketing
 * every unidentified client together, which would let one client lock the
 * archive for everyone. Raised when a rate-limit key would otherwise be empty.
 */
export class ArchiveAccessIdentityError extends Error {
  constructor() {
    super("Identitas klien tidak dapat ditentukan untuk pembatasan akses.");
    this.name = "ArchiveAccessIdentityError";
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

/** True for PostgreSQL `undefined_column` (42703). */
export function isUndefinedColumnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42703"
  );
}

/**
 * True when the access schema is absent: a missing table (42P01) OR a missing
 * column (42703). Both mean "the additive migration has not run", and both must
 * fail closed rather than be read as "no access configured".
 */
export function isAccessSchemaMissingError(error: unknown): boolean {
  return isUndefinedTableError(error) || isUndefinedColumnError(error);
}
