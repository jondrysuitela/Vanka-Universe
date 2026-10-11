import { getPool } from "@/lib/db";

/**
 * Minimal admin credential lookup (Tahap VU-ARCHIVE-ACCESS-3D).
 *
 * Mirrors the query used by the login route (`api/auth/login/route.ts`): only
 * the stored bcrypt hash is read, never the plaintext. Used by operations that
 * require re-authentication (e.g. changing the private-archive PIN) on top of an
 * already-validated session.
 */

/** Read an admin's stored password hash by id, or null when absent/unset. */
export async function selectAdminPasswordHash(adminId: string): Promise<string | null> {
  if (!adminId) return null;
  const pool = getPool();
  const result = await pool.query<{ password_hash: string | null }>(
    `SELECT password_hash FROM admins WHERE id = $1`,
    [adminId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.password_hash ?? null;
}
