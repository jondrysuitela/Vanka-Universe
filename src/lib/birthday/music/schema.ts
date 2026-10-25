/**
 * Shape of the per-edition background music (4G.46).
 *
 * PURE: types and constants only, so the admin route, the repository and the
 * public reader can all agree without importing server code or a database
 * driver. No I/O here.
 */

/** A row of `birthday_music`, as the API returns it. */
export interface BirthdayMusic {
  /** Calendar year of the edition (age 1 → 2026). */
  year: number;
  /** Edition age (1–17). */
  age: number;
  /** Media id of the audio file, or null when nothing usable is attached. */
  mediaId: string | null;
  /** Label shown in the admin (usually the original file name). */
  displayName: string | null;
  /** 0..1 trim, or null for the app default. */
  volume: number | null;
  /** ISO instant the song went live, or null while still a candidate. */
  publishedAt: string | null;
  updatedAt: string;
}

/** Request body for setting/clearing an edition's song. */
export interface BirthdayMusicInput {
  /** Media id to attach, or null to detach. */
  mediaId: string | null;
  displayName?: string | null;
  volume?: number | null;
  /** Only a published song is ever served to the public. */
  publish?: boolean;
}

/** Upper bound for the label; the DB column is VARCHAR(255). */
export const MUSIC_DISPLAY_NAME_MAX = 255;

/**
 * Largest audio upload accepted, in bytes.
 *
 * 15 MB is generous for a looping background track (a 3–4 minute MP3 at a
 * normal bitrate is 3–6 MB) while staying well under the media endpoint's
 * request cap. Enforced here AND re-checked on the stream, like every other
 * upload.
 */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Valid audio MIME types for a background song.
 *
 * ONLY `audio/mpeg` today: it is the one type the storage layer can actually
 * sniff from the leading bytes, and accepting a type the sniffer cannot verify
 * would mean trusting the client's `Content-Type`. Widening this list requires
 * teaching `sniffMime` the format first.
 */
export const AUDIO_MIME_TYPES = ["audio/mpeg"] as const;
export type AudioMime = (typeof AUDIO_MIME_TYPES)[number];

/** True when this MIME may be used as a song. */
export function isAudioMime(mime: string): mime is AudioMime {
  return (AUDIO_MIME_TYPES as readonly string[]).includes(mime);
}

/** Public byte URL of a song (date-gated, its own route). */
export function musicMediaUrl(mediaId: string): string {
  return `/api/birthday/music/media/${mediaId}`;
}

/**
 * Normalise an operator-supplied volume.
 *
 * Returns `null` (use the default) when nothing sensible was supplied, and
 * clamps into 0..1. Rejecting outright would be worse UX for a slider that
 * sends "0.05" too many decimals; the DB constraint stays as the backstop.
 */
export function normalizeVolume(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Trim and cap a display name; empty becomes null. */
export function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, MUSIC_DISPLAY_NAME_MAX);
}
