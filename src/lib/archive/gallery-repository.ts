import { getPool } from "@/lib/db";
import type { SessionAdmin } from "@/lib/auth/session";
import { PRIVATE_ARCHIVE_SLUG } from "@/lib/archive/schema";
import type { SaveGalleryInput } from "@/lib/archive/gallery-schema";

/**
 * Server-only data access for the private-archive gallery (Tahap 4G.39).
 *
 * Targets `private_archive_media` from the UNEXECUTED draft migration
 * `db/draft_migration_4g39_archive_gallery.sql`. This layer does NOT assume the
 * migration has run: a missing table raises a typed `GalleryNotMigratedError`
 * (never a silent empty gallery that would look like "saved nothing").
 *
 * The archive is a singleton identified by the stable slug `tentang-ibumu`. All
 * queries are parameterized. Ordering (`position`) is derived from the array
 * order the caller supplies — never from a client-trusted value. `media_id` is a
 * filesystem media id (never a URL/path).
 *
 * Single-statement atomicity: replacing the gallery happens in ONE statement
 * (a data-modifying CTE chain). `pool.query` may route to different connections,
 * so a BEGIN/COMMIT over `pool.query` would be unsafe; one statement avoids it.
 * `private_archives` is ensured (INSERT ... ON CONFLICT DO NOTHING) so photos can
 * be saved even before the narrative draft is written, without ever overwriting
 * an existing archive row.
 */

export interface GalleryItem {
  mediaId: string;
  title: string;
  description: string;
  memoryDate: string | null;
  position: number;
}

export interface PrivateGallery {
  /** Intro video media id, or null when none is chosen. */
  introMediaId: string | null;
  photos: GalleryItem[];
  videos: GalleryItem[];
}

interface ArchiveMediaRow {
  media_id: string;
  role: "intro" | "photo" | "video";
  title: string;
  description: string;
  memory_date: string | null;
  position: number;
}

/** Raised when the gallery table has not been migrated yet (Postgres 42P01). */
export class GalleryNotMigratedError extends Error {
  constructor() {
    super("Galeri arsip belum tersedia di database (migrasi 4g39 belum dijalankan).");
    this.name = "GalleryNotMigratedError";
  }
}

/** True when a driver error means `undefined_table` (42P01). */
export function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42P01"
  );
}

const RETURN_COLUMNS =
  "media_id, role, title, description, memory_date, position";

/** Same columns, qualified for a `private_archive_media m` join. */
const RETURN_COLUMNS_M =
  "m.media_id, m.role, m.title, m.description, m.memory_date, m.position";

function shapeGallery(rows: ArchiveMediaRow[]): PrivateGallery {
  const intro = rows.find((row) => row.role === "intro") ?? null;
  const photos = rows
    .filter((row) => row.role === "photo")
    .map((row) => ({
      mediaId: row.media_id,
      title: row.title,
      description: row.description,
      memoryDate: row.memory_date,
      position: row.position,
    }))
    .sort((a, b) => a.position - b.position);
  const videos = rows
    .filter((row) => row.role === "video")
    .map((row) => ({
      mediaId: row.media_id,
      title: row.title,
      description: row.description,
      memoryDate: row.memory_date,
      position: row.position,
    }))
    .sort((a, b) => a.position - b.position);
  return { introMediaId: intro ? intro.media_id : null, photos, videos };
}

/** Read the singleton gallery. Raises `GalleryNotMigratedError` when unmigrated. */
export async function selectGallery(): Promise<PrivateGallery> {
  const pool = getPool();
  try {
    const result = await pool.query<ArchiveMediaRow>(
      `SELECT ${RETURN_COLUMNS_M}
         FROM private_archive_media m
         JOIN private_archives a ON a.id = m.archive_id
        WHERE a.slug = $1
        ORDER BY m.role DESC, m.position ASC`,
      [PRIVATE_ARCHIVE_SLUG],
    );
    return shapeGallery(result.rows);
  } catch (error) {
    if (isUndefinedTableError(error)) throw new GalleryNotMigratedError();
    throw error;
  }
}

/**
 * Atomically replace the whole gallery (intro + ordered photos/videos).
 *
 * - `position` is 0-based per role, taken from input order (photos) / 0 (intro).
 * - Rows whose media is no longer present are removed; the rest are updated.
 * - The archive row is ensured but never overwritten.
 */
export async function replaceGallery(
  admin: SessionAdmin,
  input: SaveGalleryInput,
): Promise<PrivateGallery> {
  const mediaIds: string[] = [];
  const roles: string[] = [];
  const titles: string[] = [];
  const descriptions: string[] = [];
  const dates: (string | null)[] = [];
  const positions: number[] = [];

  if (input.introMediaId !== null) {
    mediaIds.push(input.introMediaId);
    roles.push("intro");
    titles.push("");
    descriptions.push("");
    dates.push(null);
    positions.push(0);
  }
  input.photos.forEach((photo, index) => {
    mediaIds.push(photo.mediaId);
    roles.push("photo");
    titles.push(photo.title);
    descriptions.push(photo.description);
    dates.push(photo.memoryDate);
    positions.push(index);
  });
  input.videos.forEach((video, index) => {
    mediaIds.push(video.mediaId);
    roles.push("video");
    titles.push(video.title);
    descriptions.push(video.description);
    dates.push(video.memoryDate);
    positions.push(index);
  });

  const pool = getPool();
  try {
    const result = await pool.query<ArchiveMediaRow>(
      `WITH ensure AS (
         INSERT INTO private_archives (slug, status, created_by)
         VALUES ($1, 'draft', $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id
       ),
       target AS (
         SELECT id FROM ensure
         UNION ALL
         SELECT id FROM private_archives WHERE slug = $1
         LIMIT 1
       ),
       removed AS (
         DELETE FROM private_archive_media m
          WHERE m.archive_id IN (SELECT id FROM target)
            AND m.media_id <> ALL ($3::uuid[])
       )
       INSERT INTO private_archive_media
         (archive_id, media_id, role, title, description, memory_date, position)
       SELECT t.id, v.media_id, v.role, v.title, v.description, v.memory_date, v.position
         FROM target t
         CROSS JOIN unnest(
           $3::uuid[], $4::text[], $5::text[], $6::text[], $7::date[], $8::int[]
         ) AS v(media_id, role, title, description, memory_date, position)
       ON CONFLICT (archive_id, media_id) DO UPDATE
         SET role = EXCLUDED.role,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             memory_date = EXCLUDED.memory_date,
             position = EXCLUDED.position,
             updated_at = now()
       RETURNING ${RETURN_COLUMNS}`,
      [
        PRIVATE_ARCHIVE_SLUG,
        admin.id,
        mediaIds,
        roles,
        titles,
        descriptions,
        dates,
        positions,
      ],
    );
    return shapeGallery(result.rows);
  } catch (error) {
    if (isUndefinedTableError(error)) throw new GalleryNotMigratedError();
    throw error;
  }
}
