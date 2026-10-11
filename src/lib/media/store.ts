import "server-only";

import type { SessionAdmin } from "@/lib/auth/session";
import { getMediaStore } from "@/lib/media/storage";
import type { MediaMetadataPatch, MediaRecord } from "@/lib/media/storage/types";

/**
 * Media store facade (Tahap 4G.40C).
 *
 * Preserves the ORIGINAL public API used by the media routes and tests. Each
 * function delegates to the provider selected by `MEDIA_STORAGE_DRIVER`
 * (default `filesystem`). Behavior, return semantics, validation, limits, and
 * paths are unchanged; behavior only changes when the env var selects another
 * (currently unsupported) provider.
 */

export { MediaIndexError } from "@/lib/media/storage/filesystem";
export type { MediaKind, MediaRecord, MediaMetadataPatch } from "@/lib/media/storage/types";
export { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_REQUEST_BYTES } from "@/lib/media/storage/types";

export async function listMedia(): Promise<MediaRecord[]> {
  return getMediaStore().list();
}

export async function saveMediaUpload(admin: SessionAdmin, file: File): Promise<MediaRecord> {
  return getMediaStore().save(admin, file);
}

export async function readMediaFile(
  id: string,
): Promise<{ record: MediaRecord; data: Buffer } | null> {
  return getMediaStore().read(id);
}

export async function findMediaRecord(id: string): Promise<MediaRecord | null> {
  return getMediaStore().find(id);
}

export async function updateMediaMetadata(
  id: string,
  patch: MediaMetadataPatch,
): Promise<MediaRecord | null> {
  return getMediaStore().updateMetadata(id, patch);
}

export async function deleteMedia(id: string): Promise<MediaRecord | null> {
  return getMediaStore().remove(id);
}
