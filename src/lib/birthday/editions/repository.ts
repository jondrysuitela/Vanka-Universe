import { getPool } from "@/lib/db";
import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Server-only data access for birthday editions (Tahap 4G.31).
 *
 * Creates ONE draft edition row in `birthday_editions` (`db/schema.sql`) from
 * registry-derived fields. This layer does NOT assume the database is
 * configured: a missing table simply makes the query fail, and the route reports
 * a generic server error — no row is ever fabricated.
 *
 * Creation is DRAFT-ONLY and never publishes: `status` is the literal 'draft'
 * and `privacy` the literal 'private' (the base default). Both, plus
 * `created_by`, are not parameters. `ON CONFLICT (year) DO NOTHING` guarantees a
 * duplicate edition is refused, never overwritten.
 *
 * Required columns taken from `db/schema.sql`:
 *   `year` (NOT NULL, UNIQUE), `title` (NOT NULL); the rest use their defaults.
 */

export interface BirthdayEditionRow {
  id: string;
  year: number;
  title: string;
  subtitle: string | null;
  narrative: string | null;
  cover_media_id: string | null;
  status: string;
  scheduled_at: string | null;
  published_at: string | null;
  privacy: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const RETURN_COLUMNS =
  "id, year, title, subtitle, narrative, cover_media_id, status, scheduled_at, published_at, privacy, created_by, created_at, updated_at";

export interface DraftEditionSeed {
  year: number;
  title: string;
  subtitle: string;
}

/**
 * Insert a draft edition for the given registry-derived fields.
 * Returns the created row, or null when an edition for that year already exists.
 */
export async function createDraftEdition(
  admin: SessionAdmin,
  seed: DraftEditionSeed,
): Promise<BirthdayEditionRow | null> {
  const pool = getPool();
  const result = await pool.query<BirthdayEditionRow>(
    `INSERT INTO birthday_editions (year, title, subtitle, status, privacy, created_by)
     VALUES ($1, $2, $3, 'draft', 'private', $4)
     ON CONFLICT (year) DO NOTHING
     RETURNING ${RETURN_COLUMNS}`,
    [seed.year, seed.title, seed.subtitle, admin.id],
  );
  return result.rows[0] ?? null;
}
