import { getPool } from "@/lib/db";
import { isUndefinedTableError } from "@/lib/archive/gallery-repository";
import {
  registerMediaReferenceProbe,
  type MediaReference,
} from "@/lib/media/references";

/**
 * Media-reference probe for the Arsip Ibu gallery (Tahap 4G.39D).
 *
 * READ-ONLY. Answers "is this media id referenced by a stored private-archive
 * gallery row?" for the media-delete fail-closed check (`references.ts`). It
 * never writes, never deletes, and never removes a gallery row.
 *
 * FAIL-CLOSED (a missing table is NOT "no references"):
 *  - The registry treats a PROBE THAT THROWS as `unverifiable`, which makes the
 *    media DELETE refuse. So when `private_archive_media` is not migrated yet we
 *    throw `GalleryReferenceUnavailableError` instead of returning `[]`. An
 *    empty result must mean "verifiably no references", never "could not check".
 *  - Any other query error is propagated unchanged (also => `unverifiable`).
 *
 * `media_id` is a filesystem media id (no FK); this probes the app-owned table
 * only. The gallery is a singleton identified by `private_archives.slug`.
 */

export const GALLERY_REFERENCE_SOURCE = "private_archive_gallery";

/** Raised when the gallery table is absent, so references cannot be verified. */
export class GalleryReferenceUnavailableError extends Error {
  constructor() {
    super(
      "Tabel galeri Arsip Ibu belum tersedia; referensi media tidak dapat diverifikasi.",
    );
    this.name = "GalleryReferenceUnavailableError";
  }
}

interface GalleryReferenceRow {
  slug: string;
}

/**
 * Return every stored gallery reference to `mediaId` (intro or photo).
 * Throws `GalleryReferenceUnavailableError` when the table is missing.
 */
export async function findGalleryMediaReferences(mediaId: string): Promise<MediaReference[]> {
  const pool = getPool();
  let result: { rows: GalleryReferenceRow[] };
  try {
    result = await pool.query<GalleryReferenceRow>(
      `SELECT a.slug
         FROM private_archive_media m
         JOIN private_archives a ON a.id = m.archive_id
        WHERE m.media_id = $1
        ORDER BY a.slug`,
      [mediaId],
    );
  } catch (error) {
    if (isUndefinedTableError(error)) throw new GalleryReferenceUnavailableError();
    throw error;
  }

  return result.rows.map((row) => ({
    source: GALLERY_REFERENCE_SOURCE,
    detail: `Arsip Ibu (${row.slug})`,
  }));
}

let registered = false;

/** Register the probe (idempotent). Called on import so DELETE is covered. */
export function registerGalleryReferenceProbe(): void {
  if (registered) return;
  registered = true;
  registerMediaReferenceProbe(findGalleryMediaReferences);
}

registerGalleryReferenceProbe();
