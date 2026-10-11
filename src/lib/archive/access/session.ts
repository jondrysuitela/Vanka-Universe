import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

import { PRIVATE_ARCHIVE_SLUG } from "@/lib/archive/schema";
import { getPool } from "@/lib/db";

import {
  ArchiveAccessDisabledError,
  ArchiveAccessUnavailableError,
  isAccessSchemaMissingError,
} from "./errors";
import { ARCHIVE_ACCESS_COOKIE_NAME, ARCHIVE_ACCESS_TTL_HOURS } from "./policy";

/**
 * VISITOR access sessions for the private archive (Tahap VU-ARCHIVE-ACCESS-3A).
 *
 * SEPARATE from admin sessions by construction:
 *  - different table (`archive_access_sessions`, no `admin_id`),
 *  - different cookie (`vanka_archive_access`),
 *  - different module and hash lookup. Nothing here can satisfy
 *    `requireSession`/`getSessionAdmin`, and nothing here accepts an admin role.
 *
 * Token handling mirrors the admin session: a random opaque token is sent to
 * the client; only its SHA-256 hex is stored. A DB leak does not yield a live
 * session.
 *
 * Revocation-on-PIN-change: each row snapshots the archive's `access_version`
 * at issue time. Validation requires `session.access_version = archive.access_version`,
 * so bumping `access_version` (done when the PIN changes) invalidates ALL
 * existing visitor sessions in one step, without touching their rows.
 *
 * Validation is a single statement so it shares one snapshot.
 */

export interface ArchiveAccessSession {
  id: string;
}

export interface CreateArchiveAccessSessionInput {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** SHA-256 hex of a visitor access token. Stored in DB; the raw token never is. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cryptographically random opaque token (32 bytes -> 64 hex chars). */
export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Open a visitor session and return the raw token.
 *
 * Issued ONLY from the archive's own row, in one statement: it requires the
 * singleton archive to exist, visitor access to be enabled, and a PIN to be
 * configured. If any of those is false, no row is inserted and the call fails
 * closed (`ArchiveAccessDisabledError`); a missing table/column fails closed
 * with `ArchiveAccessUnavailableError`.
 */
export async function createArchiveAccessSession(
  input: CreateArchiveAccessSessionInput = {},
): Promise<string> {
  const token = generateAccessToken();
  const tokenHash = hashAccessToken(token);
  const pool = getPool();

  let result: { rows: Array<{ id: string }> };
  try {
    result = await pool.query<{ id: string }>(
      `INSERT INTO archive_access_sessions (token_hash, access_version, expires_at, ip_address, user_agent)
       SELECT $2, a.access_version, now() + $3::interval, $4, $5
         FROM private_archives a
        WHERE a.slug = $1
          AND a.access_enabled = true
          AND a.pin_hash IS NOT NULL
       RETURNING id`,
      [
        PRIVATE_ARCHIVE_SLUG,
        tokenHash,
        `${ARCHIVE_ACCESS_TTL_HOURS} hours`,
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ],
    );
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }

  if (!result.rows.length) throw new ArchiveAccessDisabledError();
  return token;
}

/**
 * Validate a visitor access token; returns the session or null.
 *
 * Fail-closed: a missing/expired/revoked token, a disabled archive, an unset
 * PIN, or a `access_version` that no longer matches all yield null. A database
 * error rejects (never treated as a valid session).
 */
export async function validateArchiveAccessSession(
  token: string | null | undefined,
): Promise<ArchiveAccessSession | null> {
  if (!token) return null;
  const tokenHash = hashAccessToken(token);
  const pool = getPool();

  let result: { rows: Array<{ id: string }> };
  try {
    result = await pool.query<{ id: string }>(
      `SELECT s.id
         FROM archive_access_sessions s
         JOIN private_archives a ON a.slug = $2
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND a.access_enabled = true
          AND a.pin_hash IS NOT NULL
          AND s.access_version = a.access_version`,
      [tokenHash, PRIVATE_ARCHIVE_SLUG],
    );
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }

  if (!result.rows.length) return null;
  return { id: result.rows[0].id };
}

/**
 * Revoke one visitor session (lock again / logout). No-op when unknown.
 * Database errors reject and are never swallowed.
 */
export async function revokeArchiveAccessSession(token: string | null): Promise<void> {
  if (!token) return;
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE archive_access_sessions SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashAccessToken(token)],
    );
  } catch (error) {
    if (isAccessSchemaMissingError(error)) throw new ArchiveAccessUnavailableError();
    throw error;
  }
}

/** Extract the raw visitor access token from the Cookie header. */
export function readArchiveAccessToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === ARCHIVE_ACCESS_COOKIE_NAME) {
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

/** Attach the visitor access cookie to a response. */
export function setArchiveAccessCookie(response: NextResponse, token: string): void {
  response.cookies.set(ARCHIVE_ACCESS_COOKIE_NAME, token, {
    ...COOKIE_COMMON,
    maxAge: ARCHIVE_ACCESS_TTL_HOURS * 60 * 60,
  });
}

/** Clear the visitor access cookie (lock again / logout). */
export function clearArchiveAccessCookie(response: NextResponse): void {
  response.cookies.set(ARCHIVE_ACCESS_COOKIE_NAME, "", { ...COOKIE_COMMON, maxAge: 0 });
}
