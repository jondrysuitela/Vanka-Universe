import { z } from "zod";

import { THEME_MAX_AGE, THEME_MIN_AGE } from "@/lib/birthday/theme-registry";

/**
 * Validation contract for the birthday-letters API (Tahap 4G.30).
 *
 * SHAPE only. Authorization (session + role) lives in `policy.ts` and is
 * enforced server-side. `strictObject` rejects unknown keys — notably `status`,
 * `edition_id`, `created_by`, `created_at`, `published_at` — so a client can
 * never set publication state or authorship. Writes are draft-only: the route/
 * repository hardcode `status = 'draft'`.
 */

/** One letter scene — mirrors `LetterSection` in LetterScene.tsx. */
export const letterSectionSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  heading: z.string().trim().max(500),
  body: z.string().max(50000),
});

/**
 * Opening thumbnail — mirrors `LetterThumbnail`. `alt` is required by the
 * contract. `src` is either a plain public path (e.g. `/media/vanka.jpg`) or the
 * private admin media route `/api/media/[id]` used by the "Tulis Surat" editor;
 * a public read rewrites the latter to the date-gated gallery route (see
 * `letters/public-view.ts`), so the private path is never served publicly. An
 * empty/absent `src` keeps the honest placeholder.
 */
export const letterThumbnailSchema = z.strictObject({
  src: z.string().trim().max(2000).optional(),
  alt: z.string().trim().max(500),
  caption: z.string().trim().max(1000).optional(),
});

export const upsertBirthdayLetterSchema = z.strictObject({
  /** Edition age (1–17). The server maps it to the edition year. */
  age: z.number().int().min(THEME_MIN_AGE).max(THEME_MAX_AGE),
  title: z.string().trim().max(255),
  /** Presentational date string (e.g. "27 Oktober 2026"), NOT a DB DATE. */
  displayDate: z.string().trim().max(255),
  /** Canonical letter text. */
  fullText: z.string().max(200000),
  sections: z.array(letterSectionSchema).max(500),
  thumbnail: letterThumbnailSchema.nullish().transform((value) => value ?? null),
});
export type UpsertBirthdayLetterInput = z.output<typeof upsertBirthdayLetterSchema>;

/** Parse an `age` path segment; null when it is not an integer in 1–17. */
export function parseLetterAge(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const age = Number(raw);
  if (!Number.isInteger(age) || age < THEME_MIN_AGE || age > THEME_MAX_AGE) return null;
  return age;
}
