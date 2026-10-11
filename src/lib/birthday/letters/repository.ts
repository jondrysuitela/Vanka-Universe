import { getPool } from "@/lib/db";
import type { SessionAdmin } from "@/lib/auth/session";
import type { UpsertBirthdayLetterInput } from "@/lib/birthday/letters/schema";
import type { LetterSection, LetterThumbnail } from "@/components/birthday/LetterScene";

/**
 * Server-only data access for birthday letters (Tahap 4G.30).
 *
 * Writes target the `birthday_letters` table from the UNEXECUTED draft
 * migration `db/draft_migration_4g26_birthday_letters.sql`. This layer does NOT
 * assume the migration has been applied: if the table/edition is missing, the
 * queries simply find nothing and the route reports a safe error — the code
 * never fabricates an edition or a row.
 *
 * All queries are parameterized ($1, $2, ...). `status` is ALWAYS written as the
 * literal 'draft'; it is never a parameter, so a client cannot set it. The
 * ON CONFLICT guard refuses to overwrite a row that is no longer a draft.
 */

export interface BirthdayLetterRow {
  id: string;
  edition_id: string;
  /** Edition year, joined from birthday_editions so the client maps row→age. */
  year: number;
  title: string;
  display_date: string;
  full_text: string;
  sections: LetterSection[];
  thumbnail: LetterThumbnail | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const RETURN_COLUMNS =
  "id, edition_id, title, display_date, full_text, sections, thumbnail, status, created_by, created_at, updated_at";

const JOINED_COLUMNS =
  "l.id, l.edition_id, e.year, l.title, l.display_date, l.full_text, l.sections, l.thumbnail, l.status, l.created_by, l.created_at, l.updated_at";

/**
 * Resolve a birthday edition's UUID from its (UNIQUE) year. Returns null when no
 * such edition exists — the route then refuses rather than creating one.
 */
export async function selectEditionIdByYear(year: number): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM birthday_editions WHERE year = $1`,
    [year],
  );
  return result.rows[0]?.id ?? null;
}

export type UpsertLetterResult =
  | { outcome: "saved"; row: BirthdayLetterRow }
  | { outcome: "locked" };

/**
 * Insert a draft letter, or update it ONLY while it is still a draft.
 *
 * The ON CONFLICT ... WHERE `status = 'draft'` makes the update a no-op for a
 * row that is already review/scheduled/published/archived; the query then
 * returns no row and the caller maps it to a conflict. `status` is hardcoded to
 * 'draft' so this endpoint can never publish.
 */
export async function upsertDraftLetter(
  admin: SessionAdmin,
  editionId: string,
  input: UpsertBirthdayLetterInput,
): Promise<UpsertLetterResult> {
  const pool = getPool();
  const result = await pool.query<BirthdayLetterRow>(
    `INSERT INTO birthday_letters
       (edition_id, title, display_date, full_text, sections, thumbnail, status, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'draft', $7)
     ON CONFLICT (edition_id) DO UPDATE
        SET title = EXCLUDED.title,
            display_date = EXCLUDED.display_date,
            full_text = EXCLUDED.full_text,
            sections = EXCLUDED.sections,
            thumbnail = EXCLUDED.thumbnail,
            updated_at = now()
      WHERE birthday_letters.status = 'draft'
     RETURNING ${RETURN_COLUMNS}`,
    [
      editionId,
      input.title,
      input.displayDate,
      input.fullText,
      JSON.stringify(input.sections),
      input.thumbnail === null ? null : JSON.stringify(input.thumbnail),
      admin.id,
    ],
  );
  const row = result.rows[0];
  return row ? { outcome: "saved", row } : { outcome: "locked" };
}

export async function selectLetters(): Promise<BirthdayLetterRow[]> {
  const pool = getPool();
  const result = await pool.query<BirthdayLetterRow>(
    `SELECT ${JOINED_COLUMNS}
       FROM birthday_letters l
       JOIN birthday_editions e ON e.id = l.edition_id
      ORDER BY e.year ASC`,
  );
  return result.rows;
}

export async function selectLetterByYear(year: number): Promise<BirthdayLetterRow | null> {
  const pool = getPool();
  const result = await pool.query<BirthdayLetterRow>(
    `SELECT ${JOINED_COLUMNS}
       FROM birthday_letters l
       JOIN birthday_editions e ON e.id = l.edition_id
      WHERE e.year = $1`,
    [year],
  );
  return result.rows[0] ?? null;
}
