import { z } from "zod";

import { getPool } from "@/lib/db";
import { ApiError, assertSafeMutation, jsonError, jsonOk } from "@/lib/auth/guard";
import { burnDummyComparison, verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { isLoginLocked, recordLoginAttempt } from "@/lib/auth/rate-limit";
import { resolveClientIp } from "@/lib/archive/access/request";

// Note: Next.js 16 defaults route handlers to the Node.js runtime. The
// `runtime` segment config is intentionally NOT declared here because it is
// incompatible with `cacheComponents` in next.config.ts (build error).

const LOGIN_SCHEMA = z.object({
  email: z.email().trim().toLowerCase().max(255),
  password: z.string().min(1).max(200),
});

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "editor";
  is_active: boolean;
  password_hash: string | null;
}

async function findAdminByEmail(email: string): Promise<AdminRow | null> {
  const pool = getPool();
  const result = await pool.query<AdminRow>(
    `SELECT id, email, name, role, is_active, password_hash FROM admins WHERE email = $1`,
    [email],
  );
  return result.rows[0] ?? null;
}

/**
 * Client IP for the login rate limiter.
 *
 * Only a header the OPERATOR declared trustworthy (`ARCHIVE_TRUSTED_PROXY_HEADER`)
 * is read. A raw `x-forwarded-for` is client-controllable unless a proxy strips
 * it, so trusting it blindly would let an attacker forge a fresh identity per
 * attempt and defeat the lockout entirely.
 *
 * With no trusted header the IP is UNKNOWN (null); the limiter then falls back
 * to an identity-only bucket keyed by the email (see `rate-limit.ts`), which
 * still caps guessing without ever locking another account.
 */
function requestIp(request: Request): string | null {
  return resolveClientIp(request);
}

async function touchLastLogin(adminId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE admins SET last_login_at = now() WHERE id = $1`, [adminId]);
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }
    const parsed = LOGIN_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }
    const { email, password } = parsed.data;
    const ip = requestIp(request);

    if (await isLoginLocked(email, ip)) {
      return jsonError(429, "RATE_LIMITED", "Terlalu banyak percobaan masuk. Coba lagi nanti.");
    }

    const admin = await findAdminByEmail(email);

    // Never reveal whether the email exists or the account is inactive:
    // run a real bcrypt comparison either way, and always use one generic message.
    let ok = false;
    if (!admin || !admin.password_hash) {
      await burnDummyComparison(password);
    } else {
      ok = await verifyPassword(password, admin.password_hash);
    }

    if (!admin || !ok || !admin.is_active) {
      await recordLoginAttempt(email, ip, false);
      return jsonError(401, "INVALID_CREDENTIALS", "Email atau kata sandi salah.");
    }

    const token = await createSession({
      adminId: admin.id,
      ipAddress: ip,
      userAgent: request.headers.get("user-agent"),
    });
    await recordLoginAttempt(email, ip, true);
    await touchLastLogin(admin.id);

    const response = jsonOk({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}