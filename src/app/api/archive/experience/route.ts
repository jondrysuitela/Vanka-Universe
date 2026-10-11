import { ApiError, jsonError, jsonOk } from "@/lib/auth/guard";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import { isAccessSchemaMissingError } from "@/lib/archive/access/errors";
import { buildVisitorExperience } from "@/lib/archive/access/experience";
import {
  readArchiveAccessToken,
  validateArchiveAccessSession,
} from "@/lib/archive/access/session";
import {
  GalleryNotMigratedError,
  selectGallery,
} from "@/lib/archive/gallery-repository";
import { selectArchive } from "@/lib/archive/repository";

/**
 * GET /api/archive/experience — read-only Arsip Privat content for a VISITOR.
 *
 * Requires a valid visitor access session on every request; the admin session
 * cookie grants nothing here. Returns the archive's OWN `title` and `narrative`
 * (from `private_archives`) plus its intro + gallery (media ids and their stored
 * captions). Never object keys, credentials, signed URLs, or internal paths.
 * Media bytes are served by the sibling authenticated proxy
 * `/api/archive/experience/media/[id]`.
 *
 * HONESTY: `musicEnabled` is the stored flag only; audio is not supported by
 * `MediaStore`, so no audio URL/track is returned.
 *
 * Read-only: no archive data is modified. A missing schema fails closed (503).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const token = readArchiveAccessToken(request);
    const session = await validateArchiveAccessSession(token);
    if (!session) {
      return jsonError(401, "UNAUTHORIZED", "Sesi arsip tidak valid atau telah berakhir.");
    }

    const [archive, gallery] = await Promise.all([selectArchive(), selectGallery()]);
    return jsonOk(buildVisitorExperience(archive, gallery));
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof GalleryNotMigratedError) {
      return jsonError(
        503,
        "GALLERY_NOT_MIGRATED",
        "Galeri arsip belum tersedia di database (migrasi 4g39 belum dijalankan).",
      );
    }
    if (isAccessSchemaMissingError(error)) {
      // e.g. `private_archives` (4g27) not applied: fail closed, never 200-empty.
      return jsonError(503, "ARCHIVE_ACCESS_UNAVAILABLE", "Akses arsip belum tersedia.");
    }
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
