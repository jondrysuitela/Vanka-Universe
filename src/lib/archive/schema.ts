import { z } from "zod";

/**
 * Validation contract for the private-archive API (Tahap 4G.30).
 *
 * SHAPE only. The archive is ALWAYS private — there is no client-supplied
 * `privacy` flag, and the route enforces session + role server-side.
 *
 * `strictObject` rejects unknown keys. In particular the browser-local
 * `musicSrc` path/URL is NOT accepted: private audio may only be referenced by a
 * validated media id (`musicMediaId`), never a raw filesystem path or public URL.
 * `status`, `slug`, `id`, `created_by`, and timestamps are likewise rejected.
 */

/** Stable identity of the singleton archive (matches db/PRIVATE_ARCHIVE_SCHEMA_PLAN.md). */
export const PRIVATE_ARCHIVE_SLUG = "tentang-ibumu";

export const upsertArchiveSchema = z.strictObject({
  title: z.string().trim().max(255),
  narrative: z.string().max(200000),
  /** Whether the private-archive soundtrack is enabled (may be true with no asset). */
  musicEnabled: z.boolean(),
  /**
   * Private audio reference — a media UUID, or null when none is chosen. The
   * route still validates it is usable (see `media-link.ts`); today no audio
   * path exists, so any non-null value is rejected.
   */
  musicMediaId: z.uuid().nullable().optional().transform((value) => value ?? null),
});
export type UpsertArchiveInput = z.output<typeof upsertArchiveSchema>;
