import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Media storage abstraction (Tahap 4G.40C).
 *
 * Defines the provider-agnostic contract the media API consumes. The concrete
 * provider is selected in `storage/index.ts` from `MEDIA_STORAGE_DRIVER`
 * (default `filesystem`). Behavior, paths, limits, and return semantics are
 * identical to the pre-extraction filesystem implementation.
 *
 * Types only + pure constants: this module performs no I/O and imports no
 * runtime provider code, so it is safe to import anywhere the media types are
 * needed.
 */

export type MediaKind = "image" | "video" | "audio";

/**
 * Media collection pool (Tahap 4G.42B).
 *
 * Every upload lands in exactly one pool, decided at UPLOAD time (server-set,
 * never client-editable afterwards):
 *  - `birthday` — default. Anything not explicitly archived belongs to the
 *    birthday-cycle gallery (see the cycle window in `birthday/cycle.ts`).
 *  - `archive`  — the private "Arsip Ibu" pool. NEVER auto-included in the
 *    birthday gallery, and never publicly revealable through it.
 *  - `music`    — background songs for an edition (4G.46). Deliberately its
 *    own pool: a song is neither a memory nor an archive photo, and keeping it
 *    out of `birthday` means no gallery query can ever pick it up.
 */
export type MediaCollection = "birthday" | "archive" | "music";

export interface MediaRecord {
  id: string;
  name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  ownerId: string;
  ownerLabel: string;
  /** Upload timestamp (server-set, never client-writable). */
  createdAt: string;
  /** Which pool this upload belongs to (server-set at upload time). */
  collection: MediaCollection;
  /** Human-editable metadata (null until edited). */
  title: string | null;
  description: string | null;
  /** Capture date (YYYY-MM-DD), distinct from the upload date. */
  takenAt: string | null;
}

/** Human-editable metadata patch. A `null` value clears the field. */
export interface MediaMetadataPatch {
  title?: string | null;
  description?: string | null;
  takenAt?: string | null;
}

/**
 * Optional human metadata supplied AT UPLOAD time (convenience — the admin can
 * still edit it later via PATCH). Both fields are trimmed server-side; empty
 * values become `null`.
 */
export interface MediaUploadMetadata {
  title?: string | null;
  description?: string | null;
}

/** Result of reading an object: its metadata plus the bytes. */
export interface MediaReadResult {
  record: MediaRecord;
  data: Buffer;
}

/**
 * The provider contract. Implementations must preserve the existing semantics:
 * missing objects/indexes return `null` or throw a typed error — never a silent
 * "empty" that hides data; validation and size limits stay authoritative.
 */
export interface MediaStore {
  list(): Promise<MediaRecord[]>;
  save(
    admin: SessionAdmin,
    file: File,
    collection?: MediaCollection,
    metadata?: MediaUploadMetadata,
  ): Promise<MediaRecord>;
  read(id: string): Promise<MediaReadResult | null>;
  find(id: string): Promise<MediaRecord | null>;
  updateMetadata(id: string, patch: MediaMetadataPatch): Promise<MediaRecord | null>;
  remove(id: string): Promise<MediaRecord | null>;
}

/**
 * Raised when `MEDIA_STORAGE_DRIVER` is unknown/unsupported. FAIL-CLOSED: the
 * caller must never fall back to another provider silently.
 */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/**
 * Largest background song. A 3–4 minute MP3 at a normal bitrate is 3–6 MB, so
 * this is generous while keeping a looped page asset from being enormous.
 */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/** Per-kind upload cap. Single source of truth for BOTH storage providers. */
export function maxBytesForKind(kind: MediaKind): number {
  if (kind === "image") return MAX_IMAGE_BYTES;
  if (kind === "audio") return MAX_AUDIO_BYTES;
  return MAX_VIDEO_BYTES;
}

/**
 * Upper bound for a whole multipart upload request: the largest allowed file
 * (video) plus a small multipart framing allowance. Used only for an EARLY
 * `Content-Length` rejection; the per-kind cap applied after magic-byte sniffing
 * stays authoritative.
 */
export const MAX_REQUEST_BYTES = MAX_VIDEO_BYTES + 1024 * 1024;
