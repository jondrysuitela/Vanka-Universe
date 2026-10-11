import { getPool } from "@/lib/db";

/**
 * Account-level security operations that MUST be atomic with session
 * revocation.
 *
 * Why a single statement instead of BEGIN/COMMIT: the shared `DbPool`
 * abstraction (`src/lib/db.ts`) exposes only `query()`, and the pool is capped
 * at 5 connections. Consecutive `query()` calls are therefore NOT guaranteed
 * to run on the same connection, so a BEGIN executed on one call and a COMMIT
 * on another would be unsafe. Each helper below performs the account change
 * and the session revocation inside ONE SQL statement (data-modifying CTEs),
 * which PostgreSQL executes as a single implicit transaction: either both
 * effects apply or neither does.
 *
 * Failure policy (fail-closed): any database error rejects and is never
 * swallowed; the caller must not report the operation as successful. Sessions
 * are never DELETED — they are marked with `revoked_at`, matching the schema.
 *
 * These helpers have NO HTTP endpoint yet. They are intentionally narrow and
 * are the building blocks for future admin-management routes.
 */

export interface AdminSecurityResult {
  /** True when the admin row existed and was updated. */
  adminUpdated: boolean;
  /** Number of sessions whose revoked_at was set by this operation. */
  sessionsRevoked: number;
}

interface CountRow {
  admins_updated: number | string;
  sessions_revoked: number | string;
}

function toResult(row: CountRow | undefined): AdminSecurityResult {
  if (!row) {
    // The final SELECT always yields exactly one aggregate row; a missing row
    // signals an unexpected driver result. Refuse to claim success.
    throw new Error("admin security operation returned no result row");
  }
  return {
    adminUpdated: Number(row.admins_updated) > 0,
    sessionsRevoked: Number(row.sessions_revoked),
  };
}

/**
 * Deactivate an admin and revoke every still-active session of that admin,
 * atomically. Idempotent: deactivating an already-inactive admin still revokes
 * any remaining active sessions.
 *
 * Note: the current session-validation query also checks `admins.is_active`,
 * so deactivation takes effect on the very next request even before rows are
 * flipped — this operation makes that state durable.
 */
export async function deactivateAdminAndRevokeSessions(adminId: string): Promise<AdminSecurityResult> {
  if (!adminId) throw new Error("deactivateAdminAndRevokeSessions: adminId is required.");
  const pool = getPool();
  const result = await pool.query<CountRow>(
    `WITH deactivated AS (
       UPDATE admins SET is_active = false WHERE id = $1 RETURNING id
     ), revoked AS (
       UPDATE sessions SET revoked_at = now()
        WHERE admin_id = (SELECT id FROM deactivated) AND revoked_at IS NULL
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM deactivated) AS admins_updated,
            (SELECT count(*)::int FROM revoked) AS sessions_revoked`,
    [adminId],
  );
  return toResult(result.rows[0]);
}

/**
 * Set an admin's password hash and revoke ALL of that admin's sessions,
 * atomically. Callers pass an already-hashed value (`hashPassword`); the
 * plaintext never reaches this module. Refuses an empty hash so a bug cannot
 * silently blank the credential.
 *
 * Full revocation is the reset semantics. For a self-service password change
 * where the current session must survive, use `revokeAllSessionsExcept` from
 * `session.ts` instead.
 */
export async function setAdminPasswordHashAndRevokeSessions(
  adminId: string,
  passwordHash: string,
): Promise<AdminSecurityResult> {
  if (!adminId) throw new Error("setAdminPasswordHashAndRevokeSessions: adminId is required.");
  if (typeof passwordHash !== "string" || passwordHash.length === 0) {
    throw new Error("setAdminPasswordHashAndRevokeSessions: refusing to store an empty password hash.");
  }
  const pool = getPool();
  const result = await pool.query<CountRow>(
    `WITH updated AS (
       UPDATE admins SET password_hash = $2 WHERE id = $1 RETURNING id
     ), revoked AS (
       UPDATE sessions SET revoked_at = now()
        WHERE admin_id = (SELECT id FROM updated) AND revoked_at IS NULL
       RETURNING id
     )
     SELECT (SELECT count(*)::int FROM updated) AS admins_updated,
            (SELECT count(*)::int FROM revoked) AS sessions_revoked`,
    [adminId, passwordHash],
  );
  return toResult(result.rows[0]);
}
