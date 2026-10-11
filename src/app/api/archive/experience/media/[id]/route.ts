import { ApiError, jsonError } from "@/lib/auth/guard";
import { describeArchiveAccessError } from "@/lib/archive/access/error-mapping";
import {
  readArchiveAccessToken,
  validateArchiveAccessSession,
} from "@/lib/archive/access/session";
import {
  GalleryNotMigratedError,
  selectGallery,
} from "@/lib/archive/gallery-repository";
import { readMediaFile } from "@/lib/media/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/archive/experience/media/[id] — stream ONE private media file to a
 * VISITOR with a valid archive access session.
 *
 * Isolation guarantees:
 *  - The ADMIN session cookie grants nothing here; only the visitor session is
 *    checked, and this route never calls the admin guards/roles.
 *  - The id MUST belong to the archive's own intro or gallery. A visitor session
 *    can therefore never read arbitrary media, even with a valid PIN.
 *  - Bytes come from the shared `MediaStore` (`readMediaFile`); no storage
 *    driver is changed and nothing is served from `public/`.
 *  - `access_version` revocation is enforced by session validation on every
 *    request, so a PIN change invalidates stale cookies immediately.
 *
 * Range requests are supported so the browser can seek the intro video, with
 * the same MIME/status/incremental semantics as the admin media route.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const token = readArchiveAccessToken(request);
    const session = await validateArchiveAccessSession(token);
    if (!session) {
      return jsonError(401, "UNAUTHORIZED", "Sesi arsip tidak valid atau telah berakhir.");
    }

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) {
      return jsonError(400, "INVALID_ID", "ID media tidak valid.");
    }

    // Allowlist: only media that the archive actually references is readable.
    const gallery = await selectGallery();
    const allowed = new Set<string>();
    if (gallery.introMediaId) allowed.add(gallery.introMediaId);
    for (const photo of gallery.photos) allowed.add(photo.mediaId);
    if (!allowed.has(id)) {
      // 404 (not 403): do not confirm the existence of unrelated media.
      return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    }

    const found = await readMediaFile(id);
    if (!found) {
      return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    }

    const { record, data } = found;
    const total = data.byteLength;
    const baseHeaders: Record<string, string> = {
      "Content-Type": record.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
    };

    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
          return new Response(null, {
            status: 416,
            headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
          });
        }
        const last = Math.min(end, total - 1);
        const chunk = new Uint8Array(data.subarray(start, last + 1));
        return new Response(chunk, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${last}/${total}`,
            "Content-Length": String(chunk.byteLength),
          },
        });
      }
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof GalleryNotMigratedError) {
      return jsonError(
        503,
        "GALLERY_NOT_MIGRATED",
        "Galeri arsip belum tersedia di database (migrasi 4g39 belum dijalankan).",
      );
    }
    const descriptor = describeArchiveAccessError(error);
    if (descriptor) return jsonError(descriptor.status, descriptor.code, descriptor.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
