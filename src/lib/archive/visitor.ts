/**
 * Visitor-side protocol mapping + view-model parsing for the private archive
 * (Tahap VU-ARCHIVE-ACCESS-4A).
 *
 * PURE: no React, no DOM, no storage. This module never talks to the database,
 * never builds internal URLs, and never invents content. The UI components call
 * these helpers so all visitor copy/status decisions live in one testable place.
 */

/** Safe, non-enumerating copy shown to visitors. */
export const ARCHIVE_VISITOR_MESSAGES = {
  invalidPin: "PIN salah. Coba lagi.",
  rateLimited: "Terlalu banyak percobaan. Coba lagi nanti.",
  unavailable: "Arsip belum tersedia. Coba lagi nanti.",
  networkError: "Tidak dapat menghubungi server. Coba lagi.",
  sessionEnded: "Sesi arsip telah berakhir. Masukkan PIN lagi.",
  notReady: "Arsip belum siap ditampilkan. Data privat tidak dibuka.",
  loadError: "Arsip tidak dapat dimuat saat ini.",
  empty: "Belum ada kenangan yang tersimpan di arsip ini.",
  introFailed: "Video pembuka tidak dapat dimuat. Anda tetap dapat melihat galeri.",
} as const;

/* ------------------------------------------------------------------ access */

/**
 * Number of digit boxes the visitor PIN UI renders.
 *
 * This is a PURELY presentational choice and MUST stay within the server policy
 * range `[ARCHIVE_PIN_MIN_LENGTH, ARCHIVE_PIN_MAX_LENGTH]` (4–12 digits), so the
 * six-box UI submits a plain, unmodified six-digit PIN that the unchanged server
 * accepts. A unit test asserts this containment.
 */
export const ARCHIVE_PIN_UI_LENGTH = 6;

export type AccessOutcome =
  | "unlocked"
  | "invalid_pin"
  | "rate_limited"
  | "unavailable"
  | "error";

/**
 * Map `POST /api/archive/access` status to a visitor outcome. A 422 (bad PIN
 * format) is shown as a wrong PIN on purpose: the response must not reveal
 * whether a PIN/archive exists.
 */
export function mapAccessOutcome(status: number): AccessOutcome {
  if (status >= 200 && status < 300) return "unlocked";
  if (status === 401 || status === 422) return "invalid_pin";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "error";
}

/** Copy for a non-`unlocked` access outcome. */
export function accessErrorMessage(outcome: Exclude<AccessOutcome, "unlocked">): string {
  switch (outcome) {
    case "invalid_pin":
      return ARCHIVE_VISITOR_MESSAGES.invalidPin;
    case "rate_limited":
      return ARCHIVE_VISITOR_MESSAGES.rateLimited;
    case "unavailable":
      return ARCHIVE_VISITOR_MESSAGES.unavailable;
    case "error":
      return ARCHIVE_VISITOR_MESSAGES.networkError;
  }
}

/* -------------------------------------------------------------- experience */

export type ExperienceOutcome = "ok" | "unauthorized" | "not_ready" | "error";

/** Map `GET /api/archive/experience` status to a load outcome. */
export function mapExperienceOutcome(status: number): ExperienceOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "unauthorized";
  if (status === 503) return "not_ready";
  return "error";
}

/** The ONLY URL a visitor may use to stream private media (authenticated proxy). */
export function experienceMediaUrl(mediaId: string): string {
  return `/api/archive/experience/media/${encodeURIComponent(mediaId)}`;
}

export interface VisitorExperiencePhoto {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
  position: number;
}

export type VisitorExperienceVideo = VisitorExperiencePhoto;

export interface VisitorExperienceData {
  title: string;
  narrative: string;
  musicEnabled: boolean;
  introMediaId: string | null;
  photos: VisitorExperiencePhoto[];
  videos: VisitorExperienceVideo[];
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validate the experience payload without trusting it. Malformed gallery items
 * are dropped; unknown extra fields are ignored. Returns null only when the
 * envelope itself is not an object.
 */
export function parseVisitorExperience(value: unknown): VisitorExperienceData | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const photosInput = Array.isArray(raw.photos) ? raw.photos : [];
  const videosInput = Array.isArray(raw.videos) ? raw.videos : [];
  const photos: VisitorExperiencePhoto[] = [];
  const videos: VisitorExperienceVideo[] = [];
  const parseItems = (input: unknown[], target: VisitorExperiencePhoto[]) => {
    for (const item of input) {
      if (typeof item !== "object" || item === null) continue;
      const photo = item as Record<string, unknown>;
      if (typeof photo.mediaId !== "string" || photo.mediaId.length === 0) continue;
      target.push({
        mediaId: photo.mediaId,
        title: readString(photo.title),
        description: readString(photo.description),
        memoryDate:
          typeof photo.memoryDate === "string" && photo.memoryDate.length > 0
            ? photo.memoryDate
            : null,
        position: typeof photo.position === "number" ? photo.position : target.length,
      });
    }
  };
  parseItems(photosInput, photos);
  parseItems(videosInput, videos);

  return {
    title: readString(raw.title),
    narrative: readString(raw.narrative),
    musicEnabled: raw.musicEnabled === true,
    introMediaId:
      typeof raw.introMediaId === "string" && raw.introMediaId.length > 0
        ? raw.introMediaId
        : null,
    photos,
    videos,
  };
}

/* ------------------------------------------------------------------- dates */

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/**
 * Format an ISO `YYYY-MM-DD` (or `YYYY-MM-DDThh…`) date for display, using the
 * literal date parts so no timezone shift is introduced. Anything that is not
 * parseable is returned unchanged — never reformatted into invented data.
 */
export function formatMemoryDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  return `${day} ${MONTHS_ID[month - 1]} ${year}`;
}

/** Split a narrative into non-empty paragraphs for rendering. */
export function narrativeParagraphs(narrative: string): string[] {
  return narrative
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
