import {
  cycleContainingUpload,
  isCycleRevealed,
  type BirthdayCycle,
} from "@/lib/birthday/cycle";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import { MediaIndexError, findMediaRecord, listMedia } from "@/lib/media/store";
import type { MediaKind, MediaRecord } from "@/lib/media/storage/types";

/**
 * Server-only data access for the birthday gallery (Tahap 4G.42).
 *
 * The gallery of a birthday cycle is NOT a stored list: it is the set of media
 * whose UPLOAD time (`createdAt`) falls inside the cycle window. Nothing has to
 * be attached by hand, and a file can never appear in two cycles. Uploads made
 * before 27 October belong to that year's birthday; uploads made on/after 27
 * October belong to the next one. See `cycle.ts`.
 *
 * SOURCE OF TRUTH: the media STORE (`MediaStore`), the SAME provider the upload
 * API writes to — filesystem, legacy R2, or DB+R2. Reading the store (instead of
 * one specific database table) means every uploaded photo/video is visible in
 * the experience regardless of which driver is configured. The store is the only
 * layer that knows where metadata really lives.
 *
 * FAIL-CLOSED: a store that cannot be read raises the typed
 * {@link BirthdayGalleryUnavailableError} — never a silent empty gallery that
 * would look like "no memories yet".
 */

/** Raised when the media store cannot be read (never treated as "empty"). */
export class BirthdayGalleryUnavailableError extends Error {
  constructor() {
    super("Penyimpanan media belum siap; galeri ulang tahun tidak dapat dibaca.");
    this.name = "BirthdayGalleryUnavailableError";
  }
}

export interface BirthdayGalleryItem {
  id: string;
  kind: MediaKind;
  mime: string;
  name: string;
  title: string | null;
  description: string | null;
  /** Capture date (YYYY-MM-DD) when the admin set one. */
  takenAt: string | null;
  /** Upload timestamp — also the field the cycle window is computed from. */
  createdAt: string;
}

/** Run a store read, translating "store unavailable" into the typed error. */
async function guardedStoreRead<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof MediaObjectsUnavailableError || error instanceof MediaIndexError) {
      throw new BirthdayGalleryUnavailableError();
    }
    throw error;
  }
}

function rowToItem(record: MediaRecord): BirthdayGalleryItem {
  return {
    id: record.id,
    kind: record.kind,
    mime: record.mime,
    name: record.name,
    title: record.title,
    description: record.description,
    takenAt: record.takenAt,
    createdAt: record.createdAt,
  };
}

/**
 * Media uploaded inside a cycle window, oldest first (half-open: `start <= t <
 * uploadEnd`). Only the `birthday` pool participates — archive ("Arsip Ibu")
 * uploads never appear. Records written before pools existed default to
 * `birthday` (the store normalizes that on read).
 *
 * The end is `uploadEnd`, NOT `revealAt`: the birthday's own photos are taken on
 * the birthday and must still land in that year's album.
 */
export async function listCycleGallery(cycle: BirthdayCycle): Promise<BirthdayGalleryItem[]> {
  const records = await guardedStoreRead(() => listMedia());
  const start = cycle.start.getTime();
  const end = cycle.uploadEnd.getTime();

  return records
    .filter((record) => (record.collection ?? "birthday") === "birthday")
    .map((record) => ({ record, time: Date.parse(record.createdAt) }))
    .filter(({ time }) => Number.isFinite(time) && time >= start && time < end)
    .sort((a, b) => a.time - b.time || a.record.id.localeCompare(b.record.id))
    .map(({ record }) => rowToItem(record));
}

/**
 * True when a stored media id belongs to the BIRTHDAY pool AND to a cycle that
 * is already public (its birthday has passed). Used by the public byte route: a
 * media that is not in an already-revealed cycle — or that belongs to the
 * private archive pool — is NOT publicly readable, even if it exists.
 */
export async function isMediaPubliclyRevealed(mediaId: string, now: Date): Promise<boolean> {
  const record = await guardedStoreRead(() => findMediaRecord(mediaId));
  if (!record || (record.collection ?? "birthday") !== "birthday") return false;

  // NOTE: `cycleForDate` is NOT used here. During the birthday's own day a
  // cycle is ALREADY revealed but still in its upload window, so `cycleForDate`
  // would report the cycle that is still collecting — and this media, taken
  // earlier today, belongs to that one. What matters for serving bytes is
  // whether ANY cycle whose upload window contains this media is revealed.
  const uploadedAt = Date.parse(record.createdAt);
  if (!Number.isFinite(uploadedAt)) return false;
  const cycle = cycleContainingUpload(uploadedAt);
  return cycle !== null && isCycleRevealed(cycle.year, now);
}
