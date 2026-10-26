import { ApiError, assertSafeMutation, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { MEDIA_OPERATOR_ROLES } from "@/lib/media/policy";
import { limitRequestBody } from "@/lib/media/request-body";
import { checkMediaReferences } from "@/lib/media/references";
// Side-effect: registers the private-archive gallery reference probe so DELETE
// stays fail-closed for media used by Arsip Ibu (Tahap 4G.39D). Read-only.
import "@/lib/archive/gallery-references";
// Side-effect: registers the birthday-gallery reference probe so DELETE stays
// fail-closed for media that has already become public (Tahap 4G.42). Read-only.
import "@/lib/birthday/gallery/references";
// Side-effect: protect music files still attached to a birthday edition.
import "@/lib/birthday/music/references";
import { updateMediaMetadataSchema } from "@/lib/media/schema";
import { describeMediaStoreError } from "@/lib/media/storage/error-mapping";
import {
  deleteMedia,
  findMediaRecord,
  MAX_REQUEST_BYTES,
  readMediaFile,
  replaceMediaImage,
  updateMediaMetadata,
} from "@/lib/media/store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/media/[id] — stream a stored (private) file.
 *
 * Requires a valid admin session; nothing here is served statically from
 * `public/`. Range requests are supported so the browser can seek video.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);

    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) {
      throw new ApiError(400, "INVALID_ID", "ID media tidak valid.");
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
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/** Validate the `id` path segment; 400 when it is not a UUID. */
async function resolveId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    throw new ApiError(400, "INVALID_ID", "ID media tidak valid.");
  }
  return id;
}

/**
 * PATCH /api/media/[id] — update human-editable metadata (title, description,
 * capture date). Requires a session + safe mutation headers. Forbidden keys
 * (id/ownerId/createdAt/size/mime) are rejected by the strict schema (422).
 */
export async function PATCH(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);
    const id = await resolveId(ctx);

    const existing = await findMediaRecord(id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = updateMediaMetadataSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const updated = await updateMediaMetadata(id, parsed.data);
    if (!updated) return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    return jsonOk(updated);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/** PUT /api/media/[id] — replace image bytes while preserving its media ID. */
export async function PUT(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const expectedOrigin = process.env.APP_ORIGIN ?? url.origin;
    if (!origin || origin !== expectedOrigin) {
      throw new ApiError(403, "ORIGIN_REJECTED", "Origin tidak diizinkan.");
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
      throw new ApiError(403, "CONTENT_TYPE_REJECTED", "Content-Type harus multipart/form-data.");
    }
    if ((request.headers.get("x-vanka-request") ?? "").trim() !== "1") {
      throw new ApiError(403, "CSRF_HEADER_REJECTED", "Header x-vanka-request wajib disertakan.");
    }

    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);
    const id = await resolveId(ctx);
    const existing = await findMediaRecord(id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");

    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
        return jsonError(413, "FILE_TOO_LARGE", "Ukuran unggahan terlalu besar.");
      }
    }

    let form: FormData;
    try {
      form = await limitRequestBody(request, MAX_REQUEST_BYTES).formData();
    } catch (error) {
      if (error instanceof ApiError) return error.toResponse();
      return jsonError(400, "INVALID_FORM", "Body bukan multipart/form-data yang valid.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "NO_FILE", "Tidak ada hasil crop yang dikirim.");
    }

    const updated = await replaceMediaImage(id, file);
    if (!updated) return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");
    return jsonOk(updated);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/**
 * DELETE /api/media/[id] — remove a stored file, but ONLY when a reference
 * check positively proves nothing references it. Requires a session + safe
 * mutation headers.
 *
 * FAIL-CLOSED: a still-referenced media returns 409 CONFLICT; if the reference
 * status cannot be verified (no registered probe, or a probe failed) the delete
 * is refused with 409 REFERENCE_UNVERIFIED. The file is never removed in either
 * case.
 */
export async function DELETE(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);
    const id = await resolveId(ctx);

    const existing = await findMediaRecord(id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Media tidak ditemukan.");

    const verdict = await checkMediaReferences(id);
    if (verdict.verdict === "referenced") {
      return jsonError(
        409,
        "CONFLICT",
        "Media masih direferensikan dan tidak dapat dihapus.",
        verdict.references,
      );
    }
    if (verdict.verdict === "unverifiable") {
      // Fail-closed: without a way to prove the media is unreferenced, refuse.
      return jsonError(
        409,
        "REFERENCE_UNVERIFIED",
        "Status referensi media tidak dapat diverifikasi; penghapusan ditolak.",
        { reason: verdict.reason },
      );
    }

    await deleteMedia(id);
    return jsonOk({ id });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}