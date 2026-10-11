import type { PrivateGallery } from "@/lib/archive/gallery-repository";
import type { PrivateArchiveRow } from "@/lib/archive/repository";

/**
 * Visitor-facing view model for the private archive (Tahap VU-ARCHIVE-ACCESS-3D).
 *
 * PURE: turns the real archive row + gallery into a read-only payload. It adds
 * no field the schema does not have and never invents content.
 *
 * HONESTY: `musicEnabled` reports the stored flag only. Audio is NOT supported
 * by `MediaStore` (media kinds are image|video), so no music URL/track is
 * emitted and the UI must not pretend playback is possible.
 */

export interface VisitorExperiencePhoto {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
  position: number;
}

export interface VisitorExperience {
  /** Archive title, or "" when the archive row does not exist yet. */
  title: string;
  /** Archive narrative, or "" when unset. */
  narrative: string;
  /**
   * Stored soundtrack flag. `true` does NOT imply a playable asset exists —
   * audio is unsupported today; the UI must render an honest "not available"
   * state rather than a player.
   */
  musicEnabled: boolean;
  /** Intro video media id, or null. Bytes are served by the visitor media proxy. */
  introMediaId: string | null;
  photos: VisitorExperiencePhoto[];
}

export function buildVisitorExperience(
  archive: PrivateArchiveRow | null,
  gallery: PrivateGallery,
): VisitorExperience {
  return {
    title: archive?.title ?? "",
    narrative: archive?.narrative ?? "",
    musicEnabled: archive?.music_enabled ?? false,
    introMediaId: gallery.introMediaId,
    photos: gallery.photos.map((photo) => ({
      mediaId: photo.mediaId,
      title: photo.title,
      description: photo.description,
      memoryDate: photo.memoryDate,
      position: photo.position,
    })),
  };
}
