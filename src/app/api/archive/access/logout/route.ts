import { ApiError, assertSafeMutation, jsonError, jsonOk } from "@/lib/auth/guard";
import {
  ArchiveAccessUnavailableError,
} from "@/lib/archive/access/errors";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import {
  clearArchiveAccessCookie,
  readArchiveAccessToken,
  revokeArchiveAccessSession,
} from "@/lib/archive/access/session";

/**
 * POST /api/archive/access/logout — lock the archive again.
 *
 * Revokes the visitor session server-side when one is present, then ALWAYS
 * clears the visitor cookie. A missing cookie, an unknown/expired token, or an
 * unavailable access schema must never leave an unlocked state behind.
 *
 * Requires the standard safe-mutation headers (CSRF/origin/content-type).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);

    const token = readArchiveAccessToken(request);
    if (token) {
      try {
        await revokeArchiveAccessSession(token);
      } catch (error) {
        // Even if the server-side revoke cannot be confirmed (schema missing),
        // the local cookie is cleared below, so the browser is locked again.
        if (!(error instanceof ArchiveAccessUnavailableError)) throw error;
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
