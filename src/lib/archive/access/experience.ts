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
 * emitted; the UI keeps the unsupported control hidden.
 */

export interface VisitorExperiencePhoto {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
  position: number;
}

export type VisitorExperienceVideo = VisitorExperiencePhoto;

export interface VisitorExperience {
  /** Archive title, or "" when the archive row does not exist yet. */
  title: string;
  /** Archive narrative, or "" when unset. */
  narrative: string;
  /**
   * Legacy stored soundtrack flag. Audio is not surfaced until playback and
   * media storage are supported; the flag remains intact for compatibility.
   */
  musicEnabled: boolean;
  /** Intro video media id, or null. Bytes are served by the visitor media proxy. */
  introMediaId: string | null;
  photos: VisitorExperiencePhoto[];
  videos: VisitorExperienceVideo[];
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
    videos: gallery.videos.map((video) => ({
      mediaId: video.mediaId,
      title: video.title,
      description: video.description,
      memoryDate: video.memoryDate,
      position: video.position,
    })),
  };
}
