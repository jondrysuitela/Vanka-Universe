import { z } from "zod";

/**
 * Validation contracts for the Memories API (Tahap 4D).
 *
 * These schemas only describe SHAPE. Access control (who may create/read/
 * update/delete) lives in `policy.ts` and is enforced server-side; no client
 * filter is ever trusted for privacy.
 */

export const PRIVACY_VALUES = ["private", "shared", "public"] as const;
export type MemoryPrivacy = (typeof PRIVACY_VALUES)[number];

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Columns a client may sort by. Never interpolate an arbitrary sort string. */
export const SORT_COLUMNS = {
  memory_date: "memory_date",
  created_at: "created_at",
  updated_at: "updated_at",
  title: "title",
} as const;
export type MemorySortColumn = keyof typeof SORT_COLUMNS;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accept only real calendar dates in YYYY-MM-DD form (rejects e.g. 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

const isoDate = z
  .string()
  .refine(isIsoDate, { message: "Format tanggal harus YYYY-MM-DD yang valid." });

/**
 * Create body. `strictObject` means unknown keys (notably `id`, `created_by`,
 * `owner_id`, `created_at`, `updated_at`) are REJECTED with 422 — a client can
 * never set authorship or timestamps. `created_by`/`owner_id` come from the
 * session server-side.
 */
export const createMemorySchema = z.strictObject({
  title: z.string().trim().min(1).max(255),
  description: z
    .string()
    .trim()
    .max(20000)
    .nullish()
    .transform((value) => value ?? null),
  memory_date: isoDate,
  category: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  privacy: z.enum(PRIVACY_VALUES).default("private"),
});
export type CreateMemoryInput = z.output<typeof createMemorySchema>;

/**
 * Patch body. Only these five fields are updatable; everything else is
 * rejected by `strictObject` (id, created_at, created_by, owner_id, updated_at
 * are all forbidden). At least one field must be present.
 */
export const updateMemorySchema = z
  .strictObject({
    title: z.string().trim().min(1).max(255).optional(),
    description: z
      .string()
      .trim()
      .max(20000)
      .nullish()
      .transform((value) => value ?? null)
      .optional(),
    memory_date: isoDate.optional(),
    category: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .nullish()
      .transform((value) => value ?? null)
      .optional(),
    privacy: z.enum(PRIVACY_VALUES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada field yang dapat diperbarui.",
  });
export type UpdateMemoryInput = z.output<typeof updateMemorySchema>;

/**
 * List query. Deliberately non-strict so harmless extra params are ignored;
 * only whitelisted keys are ever used to build SQL.
 */
export const listMemoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  privacy: z.enum(PRIVACY_VALUES).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
  sort: z.enum(["memory_date", "created_at", "updated_at", "title"]).default("memory_date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListMemoriesQuery = z.output<typeof listMemoriesQuerySchema>;

/** Parse and validate an `id` path segment. Invalid UUID is a client error. */
export function parseMemoryId(raw: string): string | null {
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}
