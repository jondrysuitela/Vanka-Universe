import { z } from "zod";

import { ApiError, assertSafeMutation, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { burnDummyComparison, verifyPassword } from "@/lib/auth/password";
import { selectAdminPasswordHash } from "@/lib/auth/admin-credentials";
import { PRIVATE_ARCHIVE_ROLES } from "@/lib/archive/policy";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import { hashPin, isValidPinFormat } from "@/lib/archive/access/pin";
import { setArchivePin } from "@/lib/archive/access/repository";
import { resolveClientIp } from "@/lib/archive/access/request";
import { isReauthLocked, recordReauthAttempt } from "@/lib/auth/rate-limit";

/**
 * PUT /api/archive/access/pin — set or replace the private-archive PIN.
 *
 * ADMIN-only and RE-AUTHENTICATED. Order is fixed:
 *   1. assertSafeMutation (CSRF/origin/content-type)
 *   2. requireSession (valid admin session)
 *   3. requireRole (PRIVATE_ARCHIVE_ROLES)
 *   4. verify the CURRENT admin password (re-auth) against the session's admin
 *   5. hash the new PIN and update atomically
 *
 * This endpoint changes the VISITOR PIN only; it never touches the admin
 * password. A wrong current password returns a generic 401 and changes NOTHING
 * (no PIN, no `access_version`). The response never contains the password, its
 * hash, or the PIN. Bumping `access_version` (inside `setArchivePin`) invalidates
 * every existing visitor session.
 */

const PIN_SCHEMA = z.strictObject({
  pin: z.string().min(1).max(64),
  currentPassword: z.string().min(1).max(200),
});

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, PRIVATE_ARCHIVE_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = PIN_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const { pin, currentPassword } = parsed.data;
    if (!isValidPinFormat(pin)) {
      return jsonError(422, "VALIDATION_ERROR", "Format PIN tidak valid.");
    }

    // Re-authentication throttle (Tahap 4F1). Only a TRUSTED client IP (from
    // `resolveClientIp`) is used; with no trusted IP the limiter falls back to
    // identity-only counting, so guessing is capped per admin with no shared
    // bucket and no lockout of every admin. A limiter failure REJECTS here and
    // can never bypass the password verification below.
    const reauthIp = resolveClientIp(request);
    if (await isReauthLocked(admin.email, reauthIp)) {
      return jsonError(429, "RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi nanti.");
    }

    // Re-authentication. One generic failure for a missing hash or a wrong
    // password, with a dummy comparison so timing does not reveal which.
    const adminHash = await selectAdminPasswordHash(admin.id);
    let authorized = false;
    if (!adminHash) {
      await burnDummyComparison(currentPassword);
    } else {
      authorized = await verifyPassword(currentPassword, adminHash);
    }
    if (!authorized) {
      await recordReauthAttempt(admin.email, reauthIp, false);
      return jsonError(401, "INVALID_CREDENTIALS", "Kata sandi salah.");
    }
    await recordReauthAttempt(admin.email, reauthIp, true);

    const pinHash = await hashPin(pin);
    const accessVersion = await setArchivePin(admin.id, pinHash);

    // Never echo the PIN, hash, or password; only the new non-secret counter.
    return jsonOk({ accessVersion });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
