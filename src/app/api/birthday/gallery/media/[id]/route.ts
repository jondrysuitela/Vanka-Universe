import { ApiError, jsonError } from "@/lib/auth/guard";
import {
  BirthdayGalleryUnavailableError,
  isMediaPubliclyRevealed,
} from "@/lib/birthday/gallery/repository";
import { readMediaFile } from "@/lib/media/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/birthday/gallery/media/[id] — stream ONE birthday-gallery file to the
 * PUBLIC, but ONLY after that file's cycle has been revealed.
 *
 * Guarantees:
 *  - No admin session is accepted or required here. Access is decided purely by
 *    the reveal rule, so a session cookie grants nothing.
 *  - The id MUST belong to a READY media whose upload time falls in an
 *    already-revealed cycle. Everything else is a 404 (not 403), so the route
 *    never confirms the existence of not-yet-public media.
 *  - Bytes come from the shared `MediaStore` (`readMediaFile`); nothing is served
 *    from `public/`.
 *
 * Range requests are supported so the browser can seek a video, with the same
 * MIME/status/incremental semantics as the admin media route.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) {
      return jsonError(400, "INVALID_ID", "ID media tidak valid.");
    }

    const revealed = await isMediaPubliclyRevealed(id, new Date());
    if (!revealed) {
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
    if (error instanceof BirthdayGalleryUnavailableError) {
      return jsonError(
        503,
        "GALLERY_NOT_MIGRATED",
        "Penyimpanan media belum siap; galeri ulang tahun tidak dapat dibaca.",
      );
    }
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
