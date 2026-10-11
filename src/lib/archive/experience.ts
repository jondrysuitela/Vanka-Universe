import {
  type FetchLike,
  type MediaFile,
  type ServerGallery,
  loadGallery,
  loadMediaFiles,
} from "@/lib/archive/gallery-sync";

/**
 * Private-archive EXPERIENCE logic (Tahap 4G.39C).
 *
 * PURE: no rendering, no storage, no `localStorage`. It turns the server gallery
 * (`GET /api/archive/gallery`) + the media library (`GET /api/media`) into a
 * ready-to-render view model, and models the intro→gallery phase transition.
 *
 * The experience lives ONLY inside the admin-protected area. Nothing here opens
 * a public route or weakens privacy.
 */

export interface ExperiencePhoto {
  mediaId: string;
  /** Display name of the source media (best effort; never invented content). */
  name: string;
  title: string;
  description: string;
  memoryDate: string | null;
}

export interface ExperienceVideo {
  mediaId: string;
  name: string;
}

export interface Experience {
  /** Intro video, or null when none is chosen (gallery opens directly). */
  intro: ExperienceVideo | null;
  photos: ExperiencePhoto[];
}

/** Build the render model, resolving media names and preserving server order. */
export function resolveExperience(gallery: ServerGallery, files: MediaFile[]): Experience {
  const byId = new Map(files.map((file) => [file.id, file]));

  const photos = gallery.photos
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((photo) => ({
      mediaId: photo.mediaId,
      name: byId.get(photo.mediaId)?.name ?? "Foto",
      title: photo.title,
      description: photo.description,
      memoryDate: photo.memoryDate,
    }));

  const intro = gallery.introMediaId
    ? { mediaId: gallery.introMediaId, name: byId.get(gallery.introMediaId)?.name ?? "Video pembuka" }
    : null;

  return { intro, photos };
}

export type ExperienceLoadResult =
  | { status: "ok"; experience: Experience }
  | { status: "not_migrated" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/**
 * Load the gallery and media library together, then resolve the view model.
 *
 * A `503` from the gallery (draft migration not applied) is surfaced as
 * `not_migrated` — NEVER as an empty-but-saved gallery. If the media library
 * cannot be listed but the gallery can, names fall back gracefully; the media
 * files still stream from the authenticated `/api/media/[id]` route.
 */
export async function loadExperience(fetcher: FetchLike): Promise<ExperienceLoadResult> {
  const [gallery, media] = await Promise.all([loadGallery(fetcher), loadMediaFiles(fetcher)]);
  if (gallery.status !== "ok") return { status: gallery.status };
  const files = media.status === "ok" ? media.files : [];
  return { status: "ok", experience: resolveExperience(gallery.gallery, files) };
}

/* ----------------------------------------------------------------------- */
/* Intro → gallery phase                                                   */
/* ----------------------------------------------------------------------- */

export type ExperiencePhase = "intro" | "gallery";
export type ExperienceEvent = "ended" | "skip" | "intro-error" | "no-intro";

/** The phase the experience starts in: intro when a video exists, else gallery. */
export function initialPhase(experience: Experience): ExperiencePhase {
  return experience.intro ? "intro" : "gallery";
}

/**
 * Transition the phase. The move to the gallery is driven by real events:
 * the video's `ended` event, the explicit skip action, or a load error — never a
 * fixed timer. Once in the gallery the phase never moves back to the intro.
 */
export function nextPhase(current: ExperiencePhase, event: ExperienceEvent): ExperiencePhase {
  if (current === "gallery") return "gallery";
  switch (event) {
    case "ended":
    case "skip":
    case "intro-error":
    case "no-intro":
      return "gallery";
    default:
      return current;
  }
}

/** Honest banner text for a non-ok load state. */
export function experienceNote(
  status: Exclude<ExperienceLoadResult["status"], "ok">,
): { title: string; message: string } {
  switch (status) {
    case "not_migrated":
      return {
        title: "Galeri belum diaktifkan",
        message:
          "Galeri arsip belum diaktifkan di database (migrasi belum dijalankan). Ini bukan galeri kosong yang sudah tersimpan.",
      };
    case "unauthorized":
      return {
        title: "Sesi/izin tidak mencukupi",
        message: "Arsip ini hanya dapat dibuka oleh admin yang berwenang.",
      };
    case "unavailable":
      return {
        title: "Gagal memuat arsip",
        message: "Arsip tidak dapat dimuat dari server. Tidak ditampilkan sebagai galeri kosong.",
      };
  }
}
