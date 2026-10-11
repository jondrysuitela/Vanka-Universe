import {
  MediaMetadataIntegrityError,
  MediaObjectsUnavailableError,
} from "@/lib/media/db/errors";

/**
 * Error mapping for the (not-yet-active) database-backed media metadata path
 * (Tahap 4G.40D-3D0).
 *
 * The media routes currently catch `ApiError` and otherwise fall back to a
 * generic 500. The new DB-backed store can raise two typed errors that must NOT
 * surface as an opaque 500:
 *
 *   - `MediaObjectsUnavailableError` -> 503, FAIL-CLOSED. The table is missing
 *     (migration not applied); the store must never look "empty" or "broken".
 *   - `MediaMetadataIntegrityError`  -> 500, but with a SAFE internal log that
 *     never contains object keys, file paths, credentials, or the raw message.
 *
 * This module returns a plain descriptor; the route converts it with the
 * existing `jsonError`, so the response envelope is unchanged. It performs no
 * I/O and does not activate any provider.
 */

export interface MediaStoreErrorDescriptor {
  status: number;
  code: string;
  message: string;
}

/** Constant, non-revealing log marker. Never include the error message/stack. */
const INTEGRITY_LOG_MESSAGE = "media metadata integrity failure";

/**
 * Map a thrown error from the media store to a client-safe descriptor, or
 * `null` when it is not one of the typed DB-media errors (caller keeps its own
 * 500 fallback).
 */
export function describeMediaStoreError(error: unknown): {
  status: number;
  code: string;
  message: string;
} | null {
  if (error instanceof MediaObjectsUnavailableError) {
    return {
      status: 503,
      code: "MEDIA_STORE_NOT_MIGRATED",
      message: "Penyimpanan metadata media belum siap.",
    };
  }

  if (error instanceof MediaMetadataIntegrityError) {
    // Safe logging: name/category only. Never the message, stack, keys, paths,
    // or credentials — those could leak bucket/object details into logs.
    console.error(INTEGRITY_LOG_MESSAGE, {
      name: error.name,
      kind: "integrity",
    });
    return {
      status: 500,
      code: "MEDIA_INTEGRITY_ERROR",
      message: "Terjadi kesalahan pada penyimpanan media.",
    };
  }

  return null;
}
