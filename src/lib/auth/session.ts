import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

import { getPool } from "@/lib/db";

export const SESSION_COOKIE_NAME = "vanka_session";
export const SESSION_SLIDING_DAYS = 7;
export const SESSION_ABSOLUTE_DAYS = 30;

export interface SessionAdmin {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "editor";
}

interface SessionRow {
  id: string;
  email: string;
  name: string;
  role: SessionAdmin["role"];
  is_active: boolean;
  session_id: string;
}

/** SHA-256 hex of a session token. Stored in DB; raw token never is. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cryptographically random opaque token (32 bytes -> 64 hex chars). */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export interface CreateSessionInput {
  adminId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Create a session row for an admin and return the raw token.
 * Only the SHA-256 hash of the token is persisted.
 */
export async function createSession(input: CreateSessionInput): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const pool = getPool();
  await pool.query(
    `INSERT INTO sessions (admin_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + $3::interval, $4, $5)`,
    [input.adminId, tokenHash, `${SESSION_SLIDING_DAYS} days`, input.ipAddress ?? null, input.userAgent ?? null],
  );
  return token;
}

/**
 * Validate a token and return the admin, or null.
 *
 * Validation and sliding renewal happen in ONE statement (a data-modifying
 * CTE), so they share a single snapshot and a single implicit transaction:
 * a session revoked concurrently can never be renewed, and a renewal failure
 * can never leave a "valid" session behind. Guards: token exists, not revoked,
 * within sliding expiry, within the absolute 30-day deadline anchored at
 * creation, and owned by an ACTIVE admin. Any failure (including a database
 * error) rejects instead of yielding a session.
 */
export async function getSessionAdmin(token: string | null | undefined): Promise<SessionAdmin | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const pool = getPool();
  const result = await pool.query<SessionRow>(
    `WITH renewed AS (
       UPDATE sessions
          SET expires_at = LEAST(now() + interval '7 days', created_at + interval '30 days')
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
          AND created_at + interval '30 days' > now()
          AND EXISTS (
                SELECT 1 FROM admins a
                 WHERE a.id = sessions.admin_id AND a.is_active = true
              )
        RETURNING id AS session_id, admin_id
     )
     SELECT a.id, a.email, a.name, a.role, a.is_active, r.session_id
       FROM renewed r
       JOIN admins a ON a.id = r.admin_id
      WHERE a.is_active = true`,
    [tokenHash],
  );
  if (!result.rows.length) return null;

  const row = result.rows[0];
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/**
 * Revoke one session (logout). No-op when the token is unknown.
 * Database errors are NOT swallowed: they reject, so callers never report a
 * failed revocation as success.
 */
export async function revokeSession(token: string | null): Promise<void> {
  if (!token) return;
  const pool = getPool();
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}

/**
 * Revoke ALL sessions of one admin (full password reset / deactivation).
 * Only rows of that admin that are still active are touched.
 * Database errors reject and are never swallowed.
 */
export async function revokeAllSessions(adminId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL`,
    [adminId],
  );
}

/**
 * Revoke every session of an admin EXCEPT one (self-service password change:
 * keep the session performing the change, drop all others).
 * Same `admin_id` and not-already-revoked scoping as revokeAllSessions.
 * Database errors reject and are never swallowed.
 */
export async function revokeAllSessionsExcept(adminId: string, keepSessionId: string): Promise<void> {
  if (!adminId) throw new Error("revokeAllSessionsExcept: adminId is required.");
  if (!keepSessionId) throw new Error("revokeAllSessionsExcept: keepSessionId is required.");
  const pool = getPool();
  await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE admin_id = $1 AND revoked_at IS NULL AND id <> $2`,
    [adminId, keepSessionId],
  );
}

/** Extract the raw session token from the Cookie header. */
export function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      return value.length ? value : null;
    }
  }
  return null;
}

const COOKIE_COMMON = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** Attach the session cookie to a response. */
export function setSessionCookie(response: NextResponse, token: string): void {
  console.log("[DEBUG] setSessionCookie called with token:", token.slice(0, 8) + "...");
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    ...COOKIE_COMMON,
    maxAge: SESSION_ABSOLUTE_DAYS * 24 * 60 * 60,
  });
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...COOKIE_COMMON, maxAge: 0 });
}