import {
  ApiError,
  assertSafeMutation,
  jsonError,
  jsonOk,
  requireRole,
  requireSession,
} from "@/lib/auth/guard";
import { MEDIA_OPERATOR_ROLES } from "@/lib/media/policy";
import { completeDirectMediaUpload, createDirectMediaUpload } from "@/lib/media/store";
import { describeMediaStoreError } from "@/lib/media/storage/error-mapping";
import { R2ConfigError } from "@/lib/media/storage/r2";
import { StorageConfigError } from "@/lib/media/storage/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, MEDIA_OPERATOR_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Body JSON tidak valid.");
    }
    if (!isJsonObject(body)) {
      throw new ApiError(422, "INVALID_UPLOAD_REQUEST", "Permintaan unggah tidak valid.");
    }

    if (body.action === "create") {
      if (
        typeof body.name !== "string" ||
        typeof body.mime !== "string" ||
        typeof body.size !== "number"
      ) {
        throw new ApiError(422, "INVALID_UPLOAD_REQUEST", "Metadata file tidak valid.");
      }
      const plan = await createDirectMediaUpload(admin, {
        name: body.name,
        mime: body.mime,
        size: body.size,
        collection: "archive",
      });
      return jsonOk(plan, { status: 201 });
    }

    if (body.action === "complete") {
      if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
        throw new ApiError(422, "INVALID_UPLOAD_ID", "ID unggahan tidak valid.");
      }
      const record = await completeDirectMediaUpload(admin, body.id);
      return jsonOk(record);
    }

    throw new ApiError(422, "INVALID_UPLOAD_ACTION", "Aksi unggah tidak dikenal.");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof StorageConfigError || error instanceof R2ConfigError) {
      return jsonError(
        503,
        "DIRECT_UPLOAD_UNAVAILABLE",
        "Upload langsung Arsip Privat memerlukan MEDIA_STORAGE_DRIVER=db-r2 dan konfigurasi database/R2 yang siap.",
      );
    }
    const mediaError = describeMediaStoreError(error);
    if (mediaError) return jsonError(mediaError.status, mediaError.code, mediaError.message);
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
