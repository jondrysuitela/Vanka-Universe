import { getPool } from "@/lib/db";

import {
  ArchiveAccessIdentityError,
  ArchiveAccessUnavailableError,
  isAccessSchemaMissingError,
} from "./errors";
import {
  ARCHIVE_ACCESS_WINDOW_MINUTES,
  ARCHIVE_MAX_FAILURES_GLOBAL,
  ARCHIVE_MAX_FAILURES_PER_IP,
} from "./policy";

/**
 * Rate limiting for the private-archive PIN gate (Tahap VU-ARCHIVE-ACCESS-3A).
 *
 * Modeled on the admin login limiter (`src/lib/auth/rate-limit.ts`) but keyed
 * by IP only, because the PIN has no email/identity. Database-backed so it
 * survives restarts and spans instances.
 *
 * Two independent guards, both must stay below their thresholds to proceed:
 *  1. per-IP failures in the sliding window (throttles one source);
 *  2. a global failure brake far above the per-IP threshold (throttles a
 *     distributed attempt). A single IP cannot reach the global brake because
 *     it is capped by the per-IP guard first — so one IP can never lock the
 *     archive for everyone. The documented trade-off: a genuine distributed
 *     flood can trip the global brake and temporarily deny the legitimate
 *     visitor (fail-closed availability loss, not a compromise).
 *
 * A database/table error here fails closed: the caller must treat "cannot
 * verify lock status" as locked, not as open.
 *
 * IDENTITY: both functions require a NON-EMPTY client key. An unknown client
 * identity must never collapse into a single shared bucket that one client
 * could fill to lock the archive for everyone — callers pass only a
 * trusted-resolved IP, and an empty key throws `ArchiveAccessIdentityError`.
 */

interface CountRow {
  n: number | string;
}

/** True when access must be refused for this IP right now. */
export async function isArchiveAccessLocked(ip: string): Promise<boolean> {
  if (!ip) throw new ArchiveAccessIdentityError();
  const pool = getPool();
  const normalizedIp = ip;

  try {
    const [perIp, global] = await Promise.all([
      pool.query<CountRow>(
        `SELECT count(*)::int AS n
           FROM archive_access_attempts
          WHERE ip_address = $1 AND success = false
            AND attempted_at > now() - interval '${ARCHIVE_ACCESS_WINDOW_MINUTES} minutes'`,
        [normalizedIp],
      ),
      pool.query<CountRow>(
        `SELECT count(*)::int AS n
           FROM archive_access_attempts
          WHERE success = false
            AND attempted_at > now() - interval '${ARCHIVE_ACCESS_WINDOW_MINUTES} minutes'`,
      ),
    ]);

    if (Number(perIp.rows[0]?.n ?? 0) >= ARCHIVE_MAX_FAILURES_PER_IP) return true;
    if (Number(global.rows[0]?.n ?? 0) >= ARCHIVE_MAX_FAILURES_GLOBAL) return true;
    return false;
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    // Any other DB failure must NOT be read as "not locked".
    throw error;
  }
}

/**
 * Record one PIN attempt. On success, clears past failure rows for that IP so
 * the counter resets; a success row is still appended.
 */
export async function recordArchiveAccessAttempt(
  ip: string,
  success: boolean,
): Promise<void> {
  if (!ip) throw new ArchiveAccessIdentityError();
  const pool = getPool();
  const normalizedIp = ip;

  try {
    if (success) {
      await pool.query(
        `DELETE FROM archive_access_attempts WHERE ip_address = $1 AND success = false`,
        [normalizedIp],
      );
    }
    await pool.query(
      `INSERT INTO archive_access_attempts (ip_address, success) VALUES ($1, $2)`,
      [normalizedIp, success],
    );
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }
}
