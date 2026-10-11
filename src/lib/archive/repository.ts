import { getPool } from "@/lib/db";
import type { SessionAdmin } from "@/lib/auth/session";
import { PRIVATE_ARCHIVE_SLUG, type UpsertArchiveInput } from "@/lib/archive/schema";

/**
 * Server-only data access for the private archive (Tahap 4G.30).
 *
 * Targets `private_archives` from the UNEXECUTED draft migration
 * `db/draft_migration_4g27_private_archive.sql`. This layer does not assume the
 * migration has run: a missing table/row simply yields no data. No row is ever
 * seeded.
 *
 * The archive is a singleton identified by the stable slug
 * `tentang-ibumu`. All queries are parameterized. `status` is hardcoded to
 * 'draft' on insert and NEVER updated here, so it cannot be changed through
 * this API; `music_media_id` is a FK id (never a URL/path).
 */

export interface PrivateArchiveRow {
  id: string;
  slug: string;
  title: string;
  narrative: string;
  music_enabled: boolean;
  music_media_id: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const RETURN_COLUMNS =
  "id, slug, title, narrative, music_enabled, music_media_id, status, created_by, created_at, updated_at";

export async function selectArchive(): Promise<PrivateArchiveRow | null> {
  const pool = getPool();
  const result = await pool.query<PrivateArchiveRow>(
    `SELECT ${RETURN_COLUMNS} FROM private_archives WHERE slug = $1`,
    [PRIVATE_ARCHIVE_SLUG],
  );
  return result.rows[0] ?? null;
}

export async function upsertArchive(
  admin: SessionAdmin,
  input: UpsertArchiveInput,
): Promise<PrivateArchiveRow> {
  const pool = getPool();
  const result = await pool.query<PrivateArchiveRow>(
    `INSERT INTO private_archives
       (slug, title, narrative, music_enabled, music_media_id, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6)
     ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            narrative = EXCLUDED.narrative,
            music_enabled = EXCLUDED.music_enabled,
            music_media_id = EXCLUDED.music_media_id,
            updated_at = now()
     RETURNING ${RETURN_COLUMNS}`,
    [
      PRIVATE_ARCHIVE_SLUG,
      input.title,
      input.narrative,
      input.musicEnabled,
      input.musicMediaId,
      admin.id,
    ],
  );
  return result.rows[0];
}
