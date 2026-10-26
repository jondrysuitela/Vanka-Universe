import { type FetchLike, MUTATION_HEADER } from "@/lib/archive/archive-sync";

export type { FetchLike };

/**
 * Private-archive GALLERY sync (Tahap 4G.39B).
 *
 * PURE decision layer for the admin gallery editor on `/admin/archive`: it
 * performs NO storage access, NO rendering, and never touches `localStorage`.
 * The caller injects a `fetch`-like function. The in-memory edit state is owned
 * by the React component; this module only maps state <-> transport and reports
 * every network outcome explicitly so the UI can never show a false save.
 *
 * Contracts (implemented in Tahap 4G.39A):
 *  - GET /api/media                 -> { data: MediaRecord[] } (kind: image|video)
 *  - GET /api/archive/gallery       -> { data: ServerGallery }
 *  - PUT /api/archive/gallery       -> { data: ServerGallery }
 *      503 { error.code: "GALLERY_NOT_MIGRATED" } until the draft migration runs
 *      422 { error.code } for invalid media/metadata
 *
 * The gallery references media ONLY by validated media id (never a URL/path).
 */

export const GALLERY_URL = "/api/archive/gallery";
export const MEDIA_URL = "/api/media";

/** Media type as returned by the private `/api/media` endpoint. */
export type MediaKind = "image" | "video";

export interface MediaFile {
  id: string;
  name: string;
  kind: MediaKind;
}

export interface ServerGalleryItem {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
  position: number;
}

export interface ServerGallery {
  introMediaId: string | null;
  photos: ServerGalleryItem[];
  videos: ServerGalleryItem[];
}

/** Editor gallery item (position is derived from array order, never stored here). */
export interface GalleryItemState {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
}

/** The full in-memory gallery edit state. */
export interface GalleryState {
  introMediaId: string | null;
  photos: GalleryItemState[];
  videos: GalleryItemState[];
}

export const EMPTY_GALLERY_STATE: GalleryState = { introMediaId: null, photos: [], videos: [] };

/* ----------------------------------------------------------------------- */
/* Low-level guards                                                        */
/* ----------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMediaFile(value: unknown): value is MediaFile {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.kind === "image" || value.kind === "video")
  );
}

function isServerGalleryItem(value: unknown): value is ServerGalleryItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.mediaId === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (value.memoryDate === null || typeof value.memoryDate === "string")
  );
}

function isServerGallery(value: unknown): value is ServerGallery {
  if (!isRecord(value)) return false;
  if (value.introMediaId !== null && typeof value.introMediaId !== "string") return false;
  if (!Array.isArray(value.photos) || !value.photos.every(isServerGalleryItem)) return false;
  return Array.isArray(value.videos) && value.videos.every(isServerGalleryItem);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorInfo(body: unknown): { code: string; message: string } {
  const err = (body as { error?: unknown } | null)?.error;
  if (isRecord(err)) {
    const code = typeof err.code === "string" ? err.code : "UNKNOWN";
    const message = typeof err.message === "string" ? err.message : "";
    return { code, message };
  }
  return { code: "UNKNOWN", message: "" };
}

/* ----------------------------------------------------------------------- */
/* Media library                                                           */
/* ----------------------------------------------------------------------- */

export interface MediaLoadOk {
  status: "ok";
  files: MediaFile[];
}
export type MediaLoadResult = MediaLoadOk | { status: "unauthorized" } | { status: "unavailable" };

/** Load the private media list. Never throws; never invents files. */
export async function loadMediaFiles(fetcher: FetchLike): Promise<MediaLoadResult> {
  let res: Response;
  try {
    res = await fetcher(MEDIA_URL, { headers: { accept: "application/json" } });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (!res.ok) return { status: "unavailable" };
  const data = (await readJson(res) as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { status: "unavailable" };
  // Keep only well-formed image/video records; a malformed entry is dropped, not
  // silently coerced into a usable file.
  return { status: "ok", files: data.filter(isMediaFile) };
}

/** Split the media library into videos and images. */
export function splitMedia(files: MediaFile[]): { videos: MediaFile[]; images: MediaFile[] } {
  return {
    videos: files.filter((file) => file.kind === "video"),
    images: files.filter((file) => file.kind === "image"),
  };
}

/* ----------------------------------------------------------------------- */
/* Pure editor operations (never mutate the input)                         */
/* ----------------------------------------------------------------------- */

/** True when a media id is already used as the intro or a gallery item. */
export function isMediaUsed(state: GalleryState, mediaId: string): boolean {
  return (
    state.introMediaId === mediaId ||
    state.photos.some((item) => item.mediaId === mediaId) ||
    state.videos.some((item) => item.mediaId === mediaId)
  );
}

export type AddMediaResult =
  | { ok: true; state: GalleryState }
  | { ok: false; reason: "used" };

/** Append a photo; refuses a duplicate intro or gallery item. */
export function addPhoto(state: GalleryState, mediaId: string): AddMediaResult {
  if (isMediaUsed(state, mediaId)) return { ok: false, reason: "used" };
  return {
    ok: true,
    state: {
      ...state,
      photos: [...state.photos, { mediaId, title: "", description: "", memoryDate: null }],
    },
  };
}

export function addVideo(state: GalleryState, mediaId: string): AddMediaResult {
  if (isMediaUsed(state, mediaId)) return { ok: false, reason: "used" };
  return {
    ok: true,
    state: {
      ...state,
      videos: [...state.videos, { mediaId, title: "", description: "", memoryDate: null }],
    },
  };
}

/** Remove a photo from the gallery. The source file is never touched. */
export function removePhoto(state: GalleryState, mediaId: string): GalleryState {
  return { ...state, photos: state.photos.filter((p) => p.mediaId !== mediaId) };
}

export function removeVideo(state: GalleryState, mediaId: string): GalleryState {
  return { ...state, videos: state.videos.filter((item) => item.mediaId !== mediaId) };
}

/** Patch one gallery item's individual metadata. */
export function updatePhoto(
  state: GalleryState,
  mediaId: string,
  patch: Partial<Omit<GalleryItemState, "mediaId">>,
): GalleryState {
  return {
    ...state,
    photos: state.photos.map((p) => (p.mediaId === mediaId ? { ...p, ...patch } : p)),
  };
}

export function updateVideo(
  state: GalleryState,
  mediaId: string,
  patch: Partial<Omit<GalleryItemState, "mediaId">>,
): GalleryState {
  return {
    ...state,
    videos: state.videos.map((item) =>
      item.mediaId === mediaId ? { ...item, ...patch } : item,
    ),
  };
}

/** Move a photo by `delta` (-1 up / +1 down); no-op at the ends. */
export function movePhoto(state: GalleryState, index: number, delta: number): GalleryState {
  const target = index + delta;
  if (index < 0 || index >= state.photos.length) return state;
  if (target < 0 || target >= state.photos.length) return state;
  const photos = state.photos.slice();
  const [item] = photos.splice(index, 1);
  photos.splice(target, 0, item);
  return { ...state, photos };
}

export function moveVideo(state: GalleryState, index: number, delta: number): GalleryState {
  const target = index + delta;
  if (index < 0 || index >= state.videos.length) return state;
  if (target < 0 || target >= state.videos.length) return state;
  const videos = state.videos.slice();
  const [item] = videos.splice(index, 1);
  videos.splice(target, 0, item);
  return { ...state, videos };
}

/**
 * Set/clear the intro video. Setting an id already used in the gallery is
 * refused so the server's uniqueness rule is mirrored client-side.
 */
export function setIntro(state: GalleryState, mediaId: string | null): AddMediaResult {
  if (mediaId === null) return { ok: true, state: { ...state, introMediaId: null } };
  if (isMediaUsed({ ...state, introMediaId: null }, mediaId)) return { ok: false, reason: "used" };
  return { ok: true, state: { ...state, introMediaId: mediaId } };
}

/* ----------------------------------------------------------------------- */
/* Transport mapping                                                       */
/* ----------------------------------------------------------------------- */

export interface GalleryRequestBody {
  introMediaId: string | null;
  photos: GalleryItemState[];
  videos: GalleryItemState[];
}

/** Exact body accepted by `PUT /api/archive/gallery`. Position = array order. */
export function toGalleryBody(state: GalleryState): GalleryRequestBody {
  return {
    introMediaId: state.introMediaId,
    photos: state.photos.map((p) => ({
      mediaId: p.mediaId,
      title: p.title,
      description: p.description,
      memoryDate: p.memoryDate,
    })),
    videos: state.videos.map((item) => ({
      mediaId: item.mediaId,
      title: item.title,
      description: item.description,
      memoryDate: item.memoryDate,
    })),
  };
}

/** Map a server gallery into editor state, preserving server order. */
export function fromServerGallery(gallery: ServerGallery): GalleryState {
  const photos = gallery.photos
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((p) => ({
      mediaId: p.mediaId,
      title: p.title,
      description: p.description,
      memoryDate: p.memoryDate,
    }));
  const videos = gallery.videos
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      mediaId: item.mediaId,
      title: item.title,
      description: item.description,
      memoryDate: item.memoryDate,
    }));
  return { introMediaId: gallery.introMediaId, photos, videos };
}

/** True when the two gallery states are equal (used for dirty tracking). */
export function galleryStatesEqual(a: GalleryState, b: GalleryState): boolean {
  if (a.introMediaId !== b.introMediaId) return false;
  const sameItems = (left: GalleryItemState[], right: GalleryItemState[]) =>
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.mediaId === other.mediaId &&
        item.title === other.title &&
        item.description === other.description &&
        item.memoryDate === other.memoryDate
      );
    });
  return sameItems(a.photos, b.photos) && sameItems(a.videos, b.videos);
}

/* ----------------------------------------------------------------------- */
/* Load                                                                    */
/* ----------------------------------------------------------------------- */

export type GalleryLoadResult =
  | { status: "ok"; gallery: ServerGallery }
  | { status: "unauthorized" }
  | { status: "not_migrated" }
  | { status: "unavailable" };

/** GET /api/archive/gallery. Never throws; never treats 503 as "empty". */
export async function loadGallery(fetcher: FetchLike): Promise<GalleryLoadResult> {
  let res: Response;
  try {
    res = await fetcher(GALLERY_URL, { headers: { accept: "application/json" } });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (res.status === 503) return { status: "not_migrated" };
  if (!res.ok) return { status: "unavailable" };
  const data = (await readJson(res) as { data?: unknown } | null)?.data;
  if (!isServerGallery(data)) return { status: "unavailable" };
  return { status: "ok", gallery: data };
}

/* ----------------------------------------------------------------------- */
/* Save                                                                    */
/* ----------------------------------------------------------------------- */

export type GallerySaveResult =
  | { status: "saved"; gallery: ServerGallery }
  | { status: "validation"; message: string }
  | { status: "not_migrated" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/** PUT /api/archive/gallery. Success ONLY when the server confirms a valid body. */
export async function saveGallery(
  fetcher: FetchLike,
  state: GalleryState,
): Promise<GallerySaveResult> {
  let res: Response;
  try {
    res = await fetcher(GALLERY_URL, {
      method: "PUT",
      headers: { "content-type": "application/json", [MUTATION_HEADER]: "1" },
      body: JSON.stringify(toGalleryBody(state)),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (res.status === 503) return { status: "not_migrated" };
  if (res.status === 422) {
    const { message } = errorInfo(await readJson(res));
    return { status: "validation", message: message || "Data galeri tidak valid." };
  }
  if (res.ok) {
    // A 200 is NOT enough on its own: the payload must actually be a gallery.
    const data = (await readJson(res) as { data?: unknown } | null)?.data;
    if (!isServerGallery(data)) return { status: "unavailable" };
    return { status: "saved", gallery: data };
  }
  return { status: "unavailable" };
}

/* ----------------------------------------------------------------------- */
/* Honest messages                                                         */
/* ----------------------------------------------------------------------- */

export interface GalleryMessage {
  title: string;
  message: string;
  type: "success" | "info" | "error";
}

export function gallerySaveMessage(result: GallerySaveResult): GalleryMessage {
  switch (result.status) {
    case "saved":
      return {
        title: "Galeri tersimpan di server",
        message: "Video pembuka dan daftar foto tersimpan di server.",
        type: "success",
      };
    case "not_migrated":
      return {
        title: "Galeri belum diaktifkan",
        message:
          "Galeri belum diaktifkan di database. Perubahan belum tersimpan ke server.",
        type: "error",
      };
    case "unauthorized":
      return {
        title: "Sesi/izin tidak mencukupi",
        message: "Sesi tidak valid atau peran tidak diizinkan. Perubahan tetap hanya di layar ini.",
        type: "error",
      };
    case "validation":
      return {
        title: "Data tidak valid",
        message: result.message || "Media atau metadata galeri tidak valid.",
        type: "error",
      };
    case "unavailable":
      return {
        title: "Gagal menyimpan",
        message: "Server tidak mengonfirmasi penyimpanan. Perubahan tetap hanya di layar ini.",
        type: "error",
      };
  }
}

export function galleryLoadNote(status: Exclude<GalleryLoadResult["status"], "ok">): GalleryMessage {
  switch (status) {
    case "not_migrated":
      return {
        title: "Galeri belum diaktifkan",
        message:
          "Galeri belum diaktifkan di database (migrasi belum dijalankan). Ini bukan galeri kosong yang tersimpan.",
        type: "info",
      };
    case "unauthorized":
      return {
        title: "Sesi/izin tidak mencukupi",
        message: "Tidak dapat memuat galeri tersimpan karena sesi/peran tidak valid.",
        type: "error",
      };
    case "unavailable":
      return {
        title: "Gagal memuat galeri",
        message: "Galeri tersimpan tidak dapat dimuat dari server. Tidak ditampilkan sebagai galeri kosong.",
        type: "error",
      };
  }
}
