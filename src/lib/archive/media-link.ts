/**
 * Private-archive audio reference validation (Tahap 4G.30).
 *
 * The archive may reference private audio ONLY through a validated media id
 * (`private_archives.music_media_id → media(id)`), never a URL/path.
 *
 * At this stage NOTHING can safely prove that a referenced id IS private audio:
 *   - the runtime media store (`storage/media/index.json`) supports only
 *     `image`/`video` — there is no audio kind and no audio magic-byte sniffing;
 *   - the `media` table's `media_type` CHECK allows only `photo|video` until the
 *     unexecuted draft migration `db/draft_migration_4g27_private_archive.sql`
 *     widens it to include `audio`.
 *
 * FAIL-CLOSED: while the reference cannot be proven appropriate, every non-null
 * reference is REJECTED. `null` (no asset chosen) remains allowed, matching the
 * current UI where `musicEnabled` can be true with no asset.
 */
export interface AudioReferenceCheck {
  ok: boolean;
  reason?: string;
}

export function validatePrivateAudioReference(mediaId: string | null): AudioReferenceCheck {
  if (mediaId === null) return { ok: true };
  return {
    ok: false,
    reason:
      "Audio privat belum didukung: belum ada jalur media bertipe 'audio' yang dapat diverifikasi " +
      "(store runtime hanya image/video; CHECK media.media_type belum memasukkan 'audio').",
  };
}
