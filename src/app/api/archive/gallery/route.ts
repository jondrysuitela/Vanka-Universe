import {
  ApiError,
  assertSafeMutation,
  jsonError,
  jsonOk,
  requireRole,
  requireSession,
} from "@/lib/auth/guard";
import { PRIVATE_ARCHIVE_ROLES } from "@/lib/archive/policy";
import { saveGallerySchema } from "@/lib/archive/gallery-schema";
import {
  GalleryNotMigratedError,
  replaceGallery,
  selectGallery,
} from "@/lib/archive/gallery-repository";
import { findMediaRecord } from "@/lib/media/store";

/**
 * GET /api/archive/gallery — intro video + ordered photos of the private archive.
 * PUT /api/archive/gallery — atomically replace the whole gallery.
 *
 * Both require a valid admin session AND an operator role (owner/admin). The
 * archive is private: there is no client-supplied privacy flag, no public route,
 * and the gallery references media ONLY by validated media id (never a URL/path —
 * `strictObject` rejects unknown keys such as `src`).
 *
 * Server-side media validation is authoritative: the intro must be a stored
 * `video` and every photo a stored `image`. An unknown/incompatible media id is
 * rejected (422) before anything is written.
 *
 * FAIL-CLOSED: until the draft migration `4g39` is applied the gallery table does
 * not exist; reads/writes return 503 GALLERY_NOT_MIGRATED rather than a silent
 * empty gallery or a false save-success.
 */

function galleryNotMigrated(): Response {
  return jsonError(
    503,
    "GALLERY_NOT_MIGRATED",
    "Galeri arsip belum tersedia di database (migrasi 4g39 belum dijalankan).",
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, PRIVATE_ARCHIVE_ROLES);
    const gallery = await selectGallery();
    return jsonOk(gallery);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof GalleryNotMigratedError) return galleryNotMigrated();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, PRIVATE_ARCHIVE_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = saveGallerySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const { introMediaId, photos } = parsed.data;

    if (introMediaId !== null) {
      const intro = await findMediaRecord(introMediaId);
      if (!intro) {
        return jsonError(422, "MEDIA_NOT_FOUND", "Media video pembuka tidak ditemukan.", {
          mediaId: introMediaId,
        });
      }
      if (intro.kind !== "video") {
        return jsonError(422, "INTRO_NOT_VIDEO", "Video pembuka harus berupa video.");
      }
    }

    for (const photo of photos) {
      const record = await findMediaRecord(photo.mediaId);
      if (!record) {
        return jsonError(422, "MEDIA_NOT_FOUND", "Media foto tidak ditemukan.", {
          mediaId: photo.mediaId,
        });
      }
      if (record.kind !== "image") {
        return jsonError(422, "PHOTO_NOT_IMAGE", "Item galeri harus berupa foto.");
      }
    }

    const gallery = await replaceGallery(admin, parsed.data);
    return jsonOk(gallery);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof GalleryNotMigratedError) return galleryNotMigrated();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
