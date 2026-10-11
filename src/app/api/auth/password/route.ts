import { z } from "zod";

import {
  ApiError,
  assertSafeMutation,
  jsonError,
  jsonOk,
  requireSession,
} from "@/lib/auth/guard";
import { setAdminPasswordHashAndRevokeSessions } from "@/lib/auth/admin-security";
import { selectAdminPasswordHash } from "@/lib/auth/admin-credentials";
import { burnDummyComparison, hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  MAX_ADMIN_PASSWORD_LENGTH,
  passwordChangeMessage,
  validatePasswordChange,
} from "@/lib/auth/password-policy";
import { isReauthLocked, recordReauthAttempt } from "@/lib/auth/rate-limit";
import { clearSessionCookie } from "@/lib/auth/session";
import { resolveClientIp } from "@/lib/archive/access/request";

/**
 * PUT /api/auth/password — self-service admin password change (Tahap 4C).
 *
 * Order is fixed:
 *   1. assertSafeMutation (CSRF/origin/content-type)
 *   2. requireSession (valid admin session — any authenticated admin may change
 *      their OWN password; the session is the authorization, and the target is
 *      always the session's own admin, never an id from the request)
 *   3. validate the new password SERVER-SIDE
 *   4. re-authenticate with the CURRENT password (dummy compare when no hash)
 *   5. hash + store the new password AND revoke ALL of that admin's sessions in
 *      ONE atomic statement (`setAdminPasswordHashAndRevokeSessions`)
 *   6. clear this browser's session cookie
 *
 * SESSION POLICY: a password change revokes EVERY session of the admin,
 * including the one making the change, so the caller must log in again. This is
 * chosen deliberately: the update + revocation are atomic in a single CTE
 * statement (the shared `DbPool` has no transactions), whereas "keep the current
 * session" would need a second, non-atomic statement that could leave other
 * sessions alive if it failed. The plaintext/hash never appear in the response.
 */

const PASSWORD_SCHEMA = z.strictObject({
  currentPassword: z.string().min(1).max(MAX_ADMIN_PASSWORD_LENGTH),
  newPassword: z.string().min(1).max(MAX_ADMIN_PASSWORD_LENGTH),
  confirmPassword: z.string().min(1).max(MAX_ADMIN_PASSWORD_LENGTH),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = PASSWORD_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const invalid = validatePasswordChange(parsed.data);
    if (invalid) {
      return jsonError(422, "VALIDATION_ERROR", passwordChangeMessage(invalid), {
        reason: invalid,
      });
    }

    // Re-authentication throttle (Tahap 4F1). Only a TRUSTED client IP (from
    // `resolveClientIp`, i.e. `ARCHIVE_TRUSTED_PROXY_HEADER` audited in the
    // deployment) is used; with no trusted IP the limiter falls back to
    // identity-only counting, so guessing is still capped per admin with no
    // shared bucket and no lockout of every admin. A limiter failure REJECTS
    // here and therefore can never bypass the password verification below.
    const reauthIp = resolveClientIp(request);
    if (await isReauthLocked(admin.email, reauthIp)) {
      return jsonError(429, "RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi nanti.");
    }

    // Re-authentication: one generic failure, with a dummy comparison when the
    // admin has no stored hash so timing does not reveal which case applies.
    const currentHash = await selectAdminPasswordHash(admin.id);
    let authorized = false;
    if (!currentHash) {
      await burnDummyComparison(parsed.data.currentPassword);
    } else {
      authorized = await verifyPassword(parsed.data.currentPassword, currentHash);
    }
    if (!authorized) {
      await recordReauthAttempt(admin.email, reauthIp, false);
      return jsonError(401, "INVALID_CREDENTIALS", "Kata sandi saat ini salah.");
    }
    await recordReauthAttempt(admin.email, reauthIp, true);

    const newHash = await hashPassword(parsed.data.newPassword);
    const result = await setAdminPasswordHashAndRevokeSessions(admin.id, newHash);
    if (!result.adminUpdated) {
      // Authenticated but the admin row was not updated: never claim success.
      return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
    }

    const response = jsonOk({
      passwordChanged: true,
      sessionsRevoked: result.sessionsRevoked,
      requiresReauth: true,
    });
    // The current session was revoked too; drop the stale cookie.
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
