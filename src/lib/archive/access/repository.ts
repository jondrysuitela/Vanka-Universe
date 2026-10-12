import { PRIVATE_ARCHIVE_SLUG } from "@/lib/archive/schema";
import { getPool } from "@/lib/db";

import { ArchiveAccessUnavailableError, isAccessSchemaMissingError } from "./errors";

/**
 * Server-only data access for the private-archive VISITOR access
 * (Tahap VU-ARCHIVE-ACCESS-3B).
 *
 * Targets the columns added by the UNEXECUTED additive draft migration
 * `db/draft_migration_4g41_archive_access.sql` (`pin_hash`, `access_enabled`,
 * `access_version`, `pin_updated_at`). This layer does NOT assume the migration
 * has run: a missing table/column raises a typed `ArchiveAccessUnavailableError`
 * (fail-closed) rather than being read as "no PIN configured".
 *
 * All queries are parameterized. The archive is the singleton `tentang-ibumu`.
 */

export interface ArchiveAccessConfig {
  /** bcrypt hash, or null when no PIN is configured. */
  pinHash: string | null;
  /** Operator switch; false closes the archive to visitors. */
  accessEnabled: boolean;
  /** Bumped on every PIN change; visitor sessions snapshot this value. */
  accessVersion: number;
}

interface AccessConfigRow {
  pin_hash: string | null;
  access_enabled: boolean;
  access_version: number | string;
}

/**
 * Read the archive's access configuration, or null when the archive row does
 * not exist yet. Raises `ArchiveAccessUnavailableError` when the schema is
 * missing.
 */
export async function selectArchiveAccessConfig(): Promise<ArchiveAccessConfig | null> {
  const pool = getPool();
  try {
    const result = await pool.query<AccessConfigRow>(
      `SELECT pin_hash, access_enabled, access_version
         FROM private_archives
        WHERE slug = $1`,
      [PRIVATE_ARCHIVE_SLUG],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      pinHash: row.pin_hash,
      accessEnabled: row.access_enabled,
      accessVersion: Number(row.access_version),
    };
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }
}

/**
 * Set (or replace) the archive PIN hash and bump `access_version` in ONE
 * statement, ensuring the archive row exists. The version bump is what
 * invalidates every existing visitor session via `access_version` validation.
 *
 * Returns the new access version. Refuses an empty hash (a bug must never blank
 * the credential) and fails closed with `ArchiveAccessUnavailableError` when the
 * schema is missing. A missing row after the statement is an error, never a
 * silent "PIN changed".
 *
 * Implementation note (regression guard): this MUST stay a single
 * `INSERT ... ON CONFLICT DO UPDATE`. An earlier variant used
 * `WITH ensure AS (INSERT ...) ... UPDATE ... FROM target`, which looked
 * equivalent but silently updated 0 rows: every part of ONE data-modifying
 * statement reads the SAME snapshot, so the `UPDATE` could not see the row the
 * CTE had just inserted. The first-ever PIN change then created the archive row,
 * changed no column, and surfaced as a generic 500. Do not reintroduce a
 * CTE-based read-back here.
 *
 * The plaintext PIN never reaches this module; only the pre-computed hash.
 */
export async function setArchivePin(adminId: string, pinHash: string): Promise<number> {
  if (typeof pinHash !== "string" || pinHash.length === 0) {
    throw new Error("setArchivePin: refusing to store an empty PIN hash.");
  }
  const pool = getPool();
  try {
    const result = await pool.query<{ access_version: number | string }>(
      `INSERT INTO private_archives (slug, status, created_by, pin_hash, pin_updated_at, access_version)
       VALUES ($1, 'draft', $2, $3, now(), 1)
       ON CONFLICT (slug) DO UPDATE
         SET pin_hash = EXCLUDED.pin_hash,
             pin_updated_at = now(),
             access_version = private_archives.access_version + 1
       RETURNING access_version`,
      [PRIVATE_ARCHIVE_SLUG, adminId, pinHash],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("setArchivePin: the private archive row was not updated.");
    }
    return Number(row.access_version);
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }
}
