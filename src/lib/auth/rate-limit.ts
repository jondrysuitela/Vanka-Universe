import { getPool } from "@/lib/db";

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_EMAIL_IP = 5;
export const MAX_FAILURES_PER_IP = 20;

/**
 * Sliding-window lockout based on the `login_attempts` table (database-backed,
 * survives restarts / multiple instances).
 *
 * Locked when either:
 *  - >= 5 failed attempts for the same email+IP within the last 15 minutes, or
 *  - >= 20 failed attempts from the same IP within the last 15 minutes
 *    (anti-spray across many emails).
 *
 * The thresholds and window are configurable constants above.
 */
export async function isLoginLocked(email: string, ip: string | null): Promise<boolean> {
  if (!email) return false;
  const pool = getPool();
  const normalizedIp = ip ?? "";
  const [emailIp, ipWide] = await Promise.all([
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM login_attempts
        WHERE email = $1 AND ip_address = $2 AND success = false
          AND attempted_at > now() - interval '15 minutes'`,
      [email, normalizedIp],
    ),
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM login_attempts
        WHERE ip_address = $1 AND success = false
          AND attempted_at > now() - interval '15 minutes'`,
      [normalizedIp],
    ),
  ]);
  if ((emailIp.rows[0]?.n ?? 0) >= MAX_FAILURES_PER_EMAIL_IP) return true;
  if ((ipWide.rows[0]?.n ?? 0) >= MAX_FAILURES_PER_IP) return true;
  return false;
}

/**
 * Record one login attempt. On success, clears past failure rows for that
 * email+IP so the counter resets; a success row is still appended.
 */
export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  success: boolean,
): Promise<void> {
  const pool = getPool();
  const normalizedIp = ip ?? "";
  if (success) {
    await pool.query(
      `DELETE FROM login_attempts WHERE email = $1 AND ip_address = $2 AND success = false`,
      [email, normalizedIp],
    );
  }
  await pool.query(
    `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
    [email, normalizedIp, success],
  );
}

/**
 * Identity-only re-authentication threshold, used when NO trustworthy client
 * IP exists. Keyed by the admin identity alone — NOT a shared bucket: one
 * admin's failures never lock another admin, and an unconfigured trusted proxy
 * never disables the limiter nor locks every admin at once.
 */
export const REAUTH_MAX_FAILURES_PER_ADMIN = 5;

/**
 * Lockout for admin operations that re-verify the CURRENT password (password
 * change and private-archive PIN change). Shares the `login_attempts` table so
 * NO schema change is needed, and reuses the login limiter's semantics when a
 * trusted IP is present (admin+IP threshold, plus the IP-wide anti-spray).
 *
 * IP POLICY: only an IP already resolved by `resolveClientIp` (i.e. explicitly
 * named by `ARCHIVE_TRUSTED_PROXY_HEADER`) may be passed. A raw
 * `x-forwarded-for` value is never trusted here. When a trusted IP is present
 * the existing login limiter's exact semantics are reused (per admin+IP
 * threshold `MAX_FAILURES_PER_EMAIL_IP`, plus the IP-wide anti-spray
 * `MAX_FAILURES_PER_IP`). When the caller has no trusted IP, this falls back to
 * identity-only counting (`REAUTH_MAX_FAILURES_PER_ADMIN`) against rows stored
 * with `ip_address IS NULL`, so guessing is still capped per admin without a
 * shared bucket.
 *
 * FAIL-CLOSED: a database error rejects (the caller must not proceed to verify
 * the password after the limiter failed).
 */
export async function isReauthLocked(adminEmail: string, ip: string | null): Promise<boolean> {
  if (!adminEmail) throw new Error("isReauthLocked: adminEmail is required.");
  if (ip) return isLoginLocked(adminEmail, ip);
  const pool = getPool();
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM login_attempts
      WHERE email = $1 AND ip_address IS NULL AND success = false
        AND attempted_at > now() - interval '${LOGIN_WINDOW_MINUTES} minutes'`,
    [adminEmail],
  );
  return (result.rows[0]?.n ?? 0) >= REAUTH_MAX_FAILURES_PER_ADMIN;
}

/**
 * Record one re-authentication attempt. On success, clears ALL past failure
 * rows of that admin (both trusted-IP-keyed and identity-keyed) so a correct
 * password resets the lockout; a success row is still appended. With no
 * trusted IP, the failure row is stored with `ip_address = NULL` so it only
 * ever counts against that admin's identity bucket.
 */
export async function recordReauthAttempt(
  adminEmail: string,
  ip: string | null,
  success: boolean,
): Promise<void> {
  if (!adminEmail) throw new Error("recordReauthAttempt: adminEmail is required.");
  const pool = getPool();
  const normalizedIp = ip ?? null;
  if (success) {
    await pool.query(
      `DELETE FROM login_attempts WHERE email = $1 AND success = false`,
      [adminEmail],
    );
  }
  await pool.query(
    `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)`,
    [adminEmail, normalizedIp, success],
  );
}