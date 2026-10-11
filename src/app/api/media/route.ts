import { ApiError, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { MEDIA_OPERATOR_ROLES } from "@/lib/media/policy";
import { limitRequestBody } from "@/lib/media/request-body";
import { describeMediaStoreError } from "@/lib/media/storage/error-mapping";
import { MAX_REQUEST_BYTES, listMedia, saveMediaUpload } from "@/lib/media/store";

const UPLOAD_CUSTOM_HEADER = "x-vanka-request";

/**
 * CSRF/origin protection for the multipart upload endpoint.
 *
 * Mirrors `assertSafeMutation` from the auth guard, but allows
 * `multipart/form-data` (file uploads cannot be sent as JSON). Cross-site HTML
 * forms can send multipart, but cannot set the custom `x-vanka-request`
 * header, so the origin + custom-header pair stays meaningful.
 */
function assertSafeUpload(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expectedOrigin = process.env.APP_ORIGIN ?? url.origin;
  if (!origin || origin !== expectedOrigin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "Origin tidak diizinkan.");
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(403, "CONTENT_TYPE_REJECTED", "Content-Type harus multipart/form-data.");
  }

  if ((request.headers.get(UPLOAD_CUSTOM_HEADER) ?? "").trim() !== "1") {
    throw new ApiError(
      403,
      "CSRF_HEADER_REJECTED",
      `Header ${UPLOAD_CUSTOM_HEADER} wajib disertakan.`,
    );
  }
}

/** GET /api/media — list stored media metadata. Requires a session + media role. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);
    const items = await listMedia();
    return jsonOk(items);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/** POST /api/media — store one uploaded file. Requires a session + media role. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeUpload(request);
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);

    // Early rejection when the DECLARED size already exceeds any allowed upload,
    // so an oversized body is refused before it is buffered. `Content-Length` is
    // advisory only (it may be absent, or wrong for a chunked body); the real,
    // header-independent limit is enforced on the stream below (4G.23), and the
    // per-kind limit applied after magic-byte sniffing stays authoritative.
    const declaredLength = request.headers.get("content-length");
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
        return jsonError(413, "FILE_TOO_LARGE", "Ukuran unggahan terlalu besar.");
      }
    }

    // Hard cap enforced while reading the body, independent of Content-Length.
    const bounded = limitRequestBody(request, MAX_REQUEST_BYTES);
    let form: FormData;
    try {
      form = await bounded.formData();
    } catch (error) {
      // A 413 raised by the stream limiter must keep its status and code.
      if (error instanceof ApiError) return error.toResponse();
      return jsonError(400, "INVALID_FORM", "Body bukan multipart/form-data yang valid.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(422, "NO_FILE", "Tidak ada file yang dikirim.");
    }

    const record = await saveMediaUpload(admin, file);
    return jsonOk(record, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
