import { z } from "zod";

/**
 * Validation contract for media metadata edits (Tahap 4G.11).
 *
 * SHAPE only. Access control (session + role) lives in the route and is
 * enforced server-side. `strictObject` rejects unknown keys (notably `id`,
 * `ownerId`, `createdAt`, `size`, `mime`) with 422 — a client can never rewrite
 * provenance or file facts, only the human-editable metadata.
 */

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

const isoDate = z.string().refine(isIsoDate, { message: "Format tanggal harus YYYY-MM-DD yang valid." });

/**
 * Patch body. Each field is optional; `null` clears it. At least one field must
 * be present. `takenAt` is the capture date — kept distinct from the upload
 * date (`createdAt`), which is set by the server and never client-writable.
 */
export const updateMediaMetadataSchema = z
  .strictObject({
    title: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    takenAt: isoDate.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada field yang dapat diperbarui.",
  });

export type UpdateMediaMetadataInput = z.output<typeof updateMediaMetadataSchema>;
