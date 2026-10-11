import { z } from "zod";

import { ApiError, assertSafeMutation, jsonError, jsonOk } from "@/lib/auth/guard";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import { isValidPinFormat, verifyPin } from "@/lib/archive/access/pin";
import {
  isArchiveAccessLocked,
  recordArchiveAccessAttempt,
} from "@/lib/archive/access/rate-limit";
import { selectArchiveAccessConfig } from "@/lib/archive/access/repository";
import { resolveClientIp } from "@/lib/archive/access/request";
import {
  createArchiveAccessSession,
  readArchiveAccessToken,
  setArchiveAccessCookie,
  validateArchiveAccessSession,
} from "@/lib/archive/access/session";

/**
 * POST /api/archive/access — open the private archive with the visitor PIN.
 * GET  /api/archive/access — report only `{ unlocked: boolean }`.
 *
 * The visitor channel is SEPARATE from admin auth: it never reads the admin
 * session cookie and never grants an admin role. Wrong PINs return one generic
 * message; the response never reveals whether an archive/PIN exists.
 */

const ACCESS_SCHEMA = z.strictObject({
  pin: z.string().min(1).max(64),
});

/** One generic failure for every wrong/invalid credential case. */
function invalidPin(): Response {
  return jsonError(401, "INVALID_PIN", "PIN salah.");
}

export async function GET(request: Request): Promise<Response> {
  try {
    const token = readArchiveAccessToken(request);
    const session = await validateArchiveAccessSession(token);
    return jsonOk({ unlocked: session !== null });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
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

    const parsed = ACCESS_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const { pin } = parsed.data;
    if (!isValidPinFormat(pin)) {
      // Format is a property of the request, not of the archive: revealing it
      // leaks nothing about whether a PIN/archive exists.
      return jsonError(422, "VALIDATION_ERROR", "Format PIN tidak valid.");
    }

    const ip = resolveClientIp(request);
    if (!ip) {
      // FAIL-CLOSED: without a trustworthy client identity, IP-based throttling
      // is impossible. Refuse instead of bucketing everyone together (which one
      // client could fill to lock the archive for all). The generic message
      // leaks nothing. See request.ts for the IP-source limitations.
      return jsonError(503, "ARCHIVE_ACCESS_UNAVAILABLE", "Akses arsip belum tersedia.");
    }

    if (await isArchiveAccessLocked(ip)) {
      return jsonError(429, "RATE_LIMITED", "Terlalu banyak percobaan. Coba lagi nanti.");
    }

    // A missing archive row yields a null config -> null hash -> verifyPin runs a
    // dummy comparison and returns false. A missing schema throws and is mapped
    // to a generic 503 by describeArchiveAccessError.
    const config = await selectArchiveAccessConfig();
    const ok = await verifyPin(pin, config?.pinHash ?? null);

    if (!ok) {
      await recordArchiveAccessAttempt(ip, false);
      return invalidPin();
    }

    // Issue the visitor session BEFORE recording success, so a disabled archive
    // (fail-closed) never records a success.
    const token = await createArchiveAccessSession({
      ipAddress: ip,
      userAgent: request.headers.get("user-agent"),
    });
    await recordArchiveAccessAttempt(ip, true);

    const response = jsonOk({ unlocked: true });
    setArchiveAccessCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
