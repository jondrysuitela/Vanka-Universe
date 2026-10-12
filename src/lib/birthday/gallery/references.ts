import { cycleForDate, isCycleRevealed } from "@/lib/birthday/cycle";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import { MediaIndexError, findMediaRecord } from "@/lib/media/store";
import {
  registerMediaReferenceProbe,
  type MediaReference,
} from "@/lib/media/references";

/**
 * Media-reference probe for the birthday gallery (Tahap 4G.42).
 *
 * The birthday gallery is derived, not stored: every media belongs to the cycle
 * its upload time falls in. Deleting a media that has ALREADY become public
 * would therefore break the published birthday experience, so those files are
 * protected and the media DELETE refuses.
 *
 * Media in a cycle that has NOT been revealed yet is deliberately NOT protected:
 * before the birthday, an upload is still draft preparation and may be removed.
 *
 * SOURCE OF TRUTH: the media STORE (`MediaStore`) — the same provider uploads
 * write to — so protection is correct whichever driver is configured.
 *
 * FAIL-CLOSED: a store that cannot be read is NOT "no references". This probe
 * throws, the registry treats a throwing probe as `unverifiable`, and the delete
 * is refused. An empty result must mean "verifiably not public yet".
 *
 * READ-ONLY: never writes, never deletes a media record.
 */

export const BIRTHDAY_GALLERY_REFERENCE_SOURCE = "birthday_gallery";

/** Raised when the media store is unreadable, so references cannot be verified. */
export class BirthdayGalleryReferenceUnavailableError extends Error {
  constructor() {
    super("Penyimpanan media belum siap; referensi galeri ulang tahun tidak dapat diverifikasi.");
    this.name = "BirthdayGalleryReferenceUnavailableError";
  }
}

/**
 * Return a reference when `mediaId` belongs to the birthday pool AND an
 * already-revealed cycle. Throws when the store is unreadable (fail-closed).
 */
export async function findBirthdayGalleryMediaReferences(
  mediaId: string,
): Promise<MediaReference[]> {
  let record: Awaited<ReturnType<typeof findMediaRecord>>;
  try {
    record = await findMediaRecord(mediaId);
  } catch (error) {
    if (error instanceof MediaObjectsUnavailableError || error instanceof MediaIndexError) {
      throw new BirthdayGalleryReferenceUnavailableError();
    }
    throw error;
  }

  if (!record || (record.collection ?? "birthday") !== "birthday") return [];

  const cycle = cycleForDate(new Date(record.createdAt));
  if (cycle === null || !isCycleRevealed(cycle.year, new Date())) return [];

  return [
    {
      source: BIRTHDAY_GALLERY_REFERENCE_SOURCE,
      detail: `Ulang tahun ke-${cycle.age} (${cycle.year})`,
    },
  ];
}

let registered = false;

/** Register the probe (idempotent). Called on import so DELETE is covered. */
export function registerBirthdayGalleryReferenceProbe(): void {
  if (registered) return;
  registered = true;
  registerMediaReferenceProbe(findBirthdayGalleryMediaReferences);
}

registerBirthdayGalleryReferenceProbe();
