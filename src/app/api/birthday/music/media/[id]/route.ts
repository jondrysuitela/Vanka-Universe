import { ApiError, jsonError } from "@/lib/auth/guard";
import { isCycleRevealed } from "@/lib/birthday/cycle";
import { getPublishedMusicByMediaId } from "@/lib/birthday/music/repository";
import { findMediaRecord, readMediaFile } from "@/lib/media/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/birthday/music/media/[id] — stream ONE background song to the public.
 *
 * WHY NOT THE GALLERY'S BYTE ROUTE: that one exists to serve already-revealed
 * *memories* and deliberately refuses anything outside the `birthday` pool. A
 * song is a different thing with a different pool, so it gets its own door with
 * its own rule.
 *
 * THE RULE, in order:
 *  1. the id must be audio (never a photo, even if the id leaks);
 *  2. it must live in the `music` pool;
 *  3. it must be attached to a published edition;
 *  4. that edition must already be revealed — the same instant the letter and
 *     gallery unlock.
 * Anything else is a 404, not a 403, so this route never confirms the existence
 * of a song that is not public yet.
 *
 * Range requests are supported like every other media route, so a browser can
 * seek and the element can buffer progressively.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) {
      return jsonError(400, "INVALID_ID", "ID media tidak valid.");
    }

    const record = await findMediaRecord(id);
    if (!record || record.kind !== "audio" || record.collection !== "music") {
      return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    }

    const music = await getPublishedMusicByMediaId(id);
    if (!music.some(({ year }) => isCycleRevealed(year, new Date()))) {
      return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    }

    const found = await readMediaFile(id);
    if (!found) {
      return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    }

    const { data } = found;
    const total = data.byteLength;
    const headers: Record<string, string> = {
      "Content-Type": record.mime,
      "Accept-Ranges": "bytes",
      // A song is immutable once attached, so it may be cached by the browser
      // and the CDN — unlike the per-visitor gallery bytes.
      "Cache-Control": "public, max-age=3600",
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
            headers: { ...headers, "Content-Range": `bytes */${total}` },
          });
        }
        const last = Math.min(end, total - 1);
        const chunk = new Uint8Array(data.subarray(start, last + 1));
        return new Response(chunk, {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${last}/${total}`,
            "Content-Length": String(chunk.byteLength),
          },
        });
      }
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { ...headers, "Content-Length": String(total) },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
