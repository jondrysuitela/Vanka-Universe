import { getPool } from "@/lib/db";
import {
  normalizeDisplayName,
  normalizeVolume,
  type BirthdayMusic,
  type BirthdayMusicInput,
} from "@/lib/birthday/music/schema";
import { cycleWindowForYear } from "@/lib/birthday/cycle";

/**
 * Server-only data access for per-edition background music (4G.46).
 *
 * TWO READERS, DELIBERATELY SEPARATE:
 *  - `getPublishedMusic(year)` — what the PUBLIC player may use. It ignores
 *    candidates (`published_at IS NULL`), so a half-finished upload can never
 *    reach a visitor: the player simply falls back to the bundled song.
 *  - `listMusic()` — the admin view, which must show candidates too.
 *
 * A missing table is NOT an error here: the feature is additive, and an
 * un-migrated database must keep the app working (it falls back). That is why
 * every read is guarded by `isUndefinedTableError`.
 */

interface MusicRow {
  year: number;
  media_id: string | null;
  display_name: string | null;
  volume: number | null;
  published_at: Date | string | null;
  updated_at: Date | string;
}

function ageForYear(year: number): number | null {
  return cycleWindowForYear(year)?.age ?? null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToMusic(row: MusicRow): BirthdayMusic {
  return {
    year: Number(row.year),
    age: ageForYear(Number(row.year)) ?? 0,
    mediaId: row.media_id,
    displayName: row.display_name,
    volume: row.volume === null ? null : Number(row.volume),
    publishedAt: toIso(row.published_at),
    updatedAt: toIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

/** True when the query failed because the migration has not run yet. */
function isUndefinedTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
}

/**
 * The PUBLISHED song of one edition, or null.
 *
 * Null covers three honest cases and the caller must treat them the same:
 * no row, a candidate row, or no usable media attached. In every one of them
 * the player falls back to the bundled file.
 */
export async function getPublishedMusic(year: number): Promise<BirthdayMusic | null> {
  try {
    const { rows } = await getPool().query<MusicRow>(
      `SELECT e.year, m.media_id, m.display_name, m.volume, m.published_at, m.updated_at
         FROM birthday_music m
         JOIN birthday_editions e ON e.id = m.edition_id
        WHERE e.year = $1
          AND m.published_at IS NOT NULL
          AND m.media_id IS NOT NULL`,
      [year],
    );
    return rows[0] ? rowToMusic(rows[0]) : null;
  } catch (error) {
    if (isUndefinedTableError(error)) return null;
    throw error;
  }
}

/** Published editions that currently own this media id, if any. */
export async function getPublishedMusicByMediaId(mediaId: string): Promise<BirthdayMusic[]> {
  try {
    const { rows } = await getPool().query<MusicRow>(
      `SELECT e.year, m.media_id, m.display_name, m.volume, m.published_at, m.updated_at
         FROM birthday_music m
         JOIN birthday_editions e ON e.id = m.edition_id
        WHERE m.media_id = $1
          AND m.published_at IS NOT NULL`,
      [mediaId],
    );
    return rows.map(rowToMusic);
  } catch (error) {
    if (isUndefinedTableError(error)) return [];
    throw error;
  }
}

/** Every edition that has a song row, newest year first (admin view). */
export async function listMusic(): Promise<BirthdayMusic[]> {
  try {
    const { rows } = await getPool().query<MusicRow>(
      `SELECT e.year, m.media_id, m.display_name, m.volume, m.published_at, m.updated_at
         FROM birthday_music m
         JOIN birthday_editions e ON e.id = m.edition_id
        ORDER BY e.year DESC`,
    );
    return rows.map(rowToMusic);
  } catch (error) {
    if (isUndefinedTableError(error)) return [];
    throw error;
  }
}

/**
 * Create or replace the song of one edition.
 *
 * `ON CONFLICT (edition_id)` makes this idempotent: the same year can only ever
 * have one song, and setting it twice updates rather than fails. The edition
 * must already exist — an unknown year is the caller's error, not something to
 * invent an edition for.
 */
export async function setEditionMusic(
  year: number,
  input: BirthdayMusicInput,
  adminId: string | null,
): Promise<BirthdayMusic | null> {
  const { rows: editions } = await getPool().query<{ id: string }>(
    `SELECT id FROM birthday_editions WHERE year = $1`,
    [year],
  );
  const edition = editions[0];
  if (!edition) return null;

  const publishedAt = input.publish ? new Date() : null;

  const { rows } = await getPool().query<MusicRow>(
    `INSERT INTO birthday_music (edition_id, media_id, display_name, volume, published_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (edition_id) DO UPDATE
        SET media_id     = EXCLUDED.media_id,
            display_name = EXCLUDED.display_name,
            volume       = EXCLUDED.volume,
            published_at = EXCLUDED.published_at,
            updated_at   = now()
     RETURNING media_id, display_name, volume, published_at, updated_at,
               (SELECT year FROM birthday_editions WHERE id = birthday_music.edition_id) AS year`,
    [
      edition.id,
      input.mediaId,
      normalizeDisplayName(input.displayName ?? null),
      normalizeVolume(input.volume ?? null),
      publishedAt,
      adminId,
    ],
  );
  return rows[0] ? rowToMusic(rows[0]) : null;
}

/** Publish or unpublish an existing song row. */
export async function setMusicPublished(year: number, publish: boolean): Promise<BirthdayMusic | null> {
  const { rows } = await getPool().query<MusicRow>(
    `UPDATE birthday_music m
        SET published_at = $2, updated_at = now()
       FROM birthday_editions e
      WHERE e.id = m.edition_id AND e.year = $1
      RETURNING e.year, m.media_id, m.display_name, m.volume, m.published_at, m.updated_at`,
    [year, publish ? new Date() : null],
  );
  return rows[0] ? rowToMusic(rows[0]) : null;
}

/** Remove an edition's song entirely (the player falls back again). */
export async function clearEditionMusic(year: number): Promise<boolean> {
  const { rows } = await getPool().query<{ id: string }>(
    `DELETE FROM birthday_music m
      USING birthday_editions e
      WHERE e.id = m.edition_id AND e.year = $1
      RETURNING m.edition_id AS id`,
    [year],
  );
  return rows.length > 0;
}
