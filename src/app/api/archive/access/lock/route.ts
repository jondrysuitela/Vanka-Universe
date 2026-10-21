import { ApiError, jsonError, jsonOk } from "@/lib/auth/guard";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import {
  clearArchiveAccessCookie,
  readArchiveAccessToken,
  revokeArchiveAccessSession,
} from "@/lib/archive/access/session";

/**
 * POST /api/archive/access/lock — BEACON-ONLY lock, used when the visitor
 * LEAVES the archive page.
 *
 * WHY A SEPARATE ENDPOINT (and not `/api/archive/access/logout`):
 *   `assertSafeMutation` requires the custom header `x-vanka-request: 1` to
 *   prove the request came from a `fetch` in our own code. `navigator
 *   .sendBeacon` CANNOT set custom headers, so the beacon could never satisfy
 *   that guard — and a beacon is exactly what is needed to revoke the session
 *   DURING page unload, where an ordinary `fetch` is cancelled by the browser.
 *
 *   The regular logout route keeps the strict guard. This route relaxes ONLY the
 *   custom-header requirement, and ONLY for an operation that revokes the
 *   caller's OWN visitor session (it grants nothing).
 *
 * CSRF REASONING (why dropping the custom header is safe here):
 *   1. `Origin` must equal the trusted app origin. A beacon sent from another
 *      site carries that site's origin, so it is rejected.
 *   2. `Content-Type` must be `application/json`. An HTML form can only send
 *      `application/x-www-form-urlencoded`, `multipart/form-data`, or
 *      `text/plain`, so a cross-site form cannot produce this request.
 *   3. A cross-site `fetch`/`sendBeacon` with `application/json` is not a
 *      "simple" request: it triggers a CORS preflight, which this route does
 *      not answer with permissive CORS headers, so the real request is never
 *      sent.
 *   Together these make a cross-site forced logout impossible while still
 *   allowing the browser's own unload beacon.
 *
 * FAIL-CLOSED: the cookie is ALWAYS cleared, even when the server-side revoke
 * cannot be confirmed. A stale cookie must never leave the archive unlocked.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const expectedOrigin = process.env.APP_ORIGIN ?? url.origin;
    const origin = request.headers.get("origin");
    if (!origin || origin !== expectedOrigin) {
      throw new ApiError(403, "ORIGIN_REJECTED", "Origin tidak diizinkan.");
    }

    const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      throw new ApiError(403, "CONTENT_TYPE_REJECTED", "Content-Type harus application/json.");
    }

    const token = readArchiveAccessToken(request);
    if (token) {
      try {
        await revokeArchiveAccessSession(token);
      } catch {
        // FAIL-CLOSED: the cookie is cleared below REGARDLESS of whether the
        // server-side revoke could be confirmed (missing schema, or any other
        // database failure). A stale cookie must never leave the archive
        // unlocked, so a revoke error must NOT skip the cookie clearing.
      }
    }

    const response = jsonOk({ unlocked: false });
    clearArchiveAccessCookie(response);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
