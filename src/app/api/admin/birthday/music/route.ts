import {
  ApiError,
  assertSafeMutation,
  jsonError,
  jsonOk,
  requireRole,
  requireSession,
} from "@/lib/auth/guard";
import { BIRTHDAY_EDITION_ROLES } from "@/lib/birthday/editions/policy";
import { isCycleYear } from "@/lib/birthday/cycle";
import {
  clearEditionMusic,
  listMusic,
  setEditionMusic,
  setMusicPublished,
} from "@/lib/birthday/music/repository";
import { isAudioMime, normalizeVolume } from "@/lib/birthday/music/schema";
import { findMediaRecord } from "@/lib/media/store";

/**
 * GET /api/admin/birthday/music — every edition that has a song, plus which
 * editions exist. Admin-only: this is the WRITE side of the feature and must
 * never be public, even though the resulting song is.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_EDITION_ROLES);
    const music = await listMusic();
    return jsonOk({ music });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/**
 * PUT /api/admin/birthday/music — attach, publish, or clear one edition's song.
 *
 * The body names the edition by YEAR (not age): the calendar year is what every
 * other birthday table stores, and age is derived from it, never the reverse.
 *
 * Validation happens BEFORE any write so a bad request can never leave the
 * edition half-configured:
 *  - the media must exist AND be an audio file — an image id is rejected;
 *  - `mediaId: null` detaches the song (the player falls back);
 *  - `publish` defaults to false, so attaching a candidate never goes live by
 *    accident.
 */
export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_EDITION_ROLES);

    const body = (await request.json().catch(() => null)) as
      | {
          year?: unknown;
          mediaId?: unknown;
          displayName?: unknown;
          volume?: unknown;
          publish?: unknown;
        }
      | null;

    if (!body || typeof body !== "object") {
      return jsonError(400, "INVALID_BODY", "Body harus berupa JSON.");
    }

    const year = Number(body.year);
    if (!Number.isInteger(year) || !isCycleYear(year)) {
      return jsonError(422, "INVALID_YEAR", "Tahun edisi tidak valid (harus usia 1–17).");
    }

    const rawMediaId = body.mediaId;
    const mediaId =
      rawMediaId === null || rawMediaId === undefined
        ? null
        : typeof rawMediaId === "string" && rawMediaId !== ""
          ? rawMediaId
          : undefined;
    if (mediaId === undefined) {
      return jsonError(422, "INVALID_MEDIA_ID", "mediaId harus string atau null.");
    }

    if (mediaId !== null) {
      const record = await findMediaRecord(mediaId);
      if (!record) {
        return jsonError(404, "MEDIA_NOT_FOUND", "Media tidak ditemukan.");
      }
      if (!isAudioMime(record.mime)) {
        return jsonError(422, "NOT_AUDIO", "Lagu harus berupa file audio MP3.");
      }
      if (record.collection !== "music") {
        // A song must live in its own pool; attaching a birthday photo id as a
        // song would make the gallery and the player disagree about that file.
        return jsonError(
          422,
          "WRONG_COLLECTION",
          "File ini bukan dari kolam musik. Unggah ulang lewat halaman Musik Ulang Tahun.",
        );
      }
    }

    const publish = body.publish === true;
    const record = await setEditionMusic(
      year,
      {
        mediaId,
        displayName: typeof body.displayName === "string" ? body.displayName : null,
        volume: normalizeVolume(body.volume),
        publish,
      },
      admin.id,
    );

    if (!record) {
      return jsonError(
        404,
        "EDITION_NOT_FOUND",
        `Edisi ${year} belum ada. Buat edisinya lebih dulu sebelum memasang lagu.`,
      );
    }
    return jsonOk(record);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/** PATCH /api/admin/birthday/music — publish or unpublish without re-uploading. */
export async function PATCH(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_EDITION_ROLES);

    const body = (await request.json().catch(() => null)) as
      | { year?: unknown; publish?: unknown }
      | null;
    if (!body || typeof body !== "object") {
      return jsonError(400, "INVALID_BODY", "Body harus berupa JSON.");
    }

    const year = Number(body.year);
    if (!Number.isInteger(year) || !isCycleYear(year)) {
      return jsonError(422, "INVALID_YEAR", "Tahun edisi tidak valid (harus usia 1–17).");
    }
    if (typeof body.publish !== "boolean") {
      return jsonError(422, "INVALID_PUBLISH", "publish harus true atau false.");
    }

    const record = await setMusicPublished(year, body.publish);
    if (!record) {
      return jsonError(404, "MUSIC_NOT_FOUND", "Edisi ini belum punya lagu.");
    }
    return jsonOk(record);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/** DELETE /api/admin/birthday/music?year=2026 — detach the song entirely. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_EDITION_ROLES);

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    if (!Number.isInteger(year) || !isCycleYear(year)) {
      return jsonError(422, "INVALID_YEAR", "Tahun edisi tidak valid (harus usia 1–17).");
    }

    const removed = await clearEditionMusic(year);
    if (!removed) {
      return jsonError(404, "MUSIC_NOT_FOUND", "Edisi ini belum punya lagu.");
    }
    return jsonOk({ year, removed: true });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
