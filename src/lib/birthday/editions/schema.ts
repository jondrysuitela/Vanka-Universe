import { z } from "zod";

import { THEME_MAX_AGE, THEME_MIN_AGE } from "@/lib/birthday/theme-registry";

/**
 * Validation contract for birthday-edition creation (Tahap 4G.31).
 *
 * The client supplies ONLY the edition age. `year`, `title`, `subtitle`,
 * `status`, `privacy`, and `created_by` are all derived server-side from the
 * static registry and the validated session — never from the body.
 * `strictObject` rejects any attempt to set them (including `id`, `year`,
 * `status`, `privacy`, `published_at`).
 */
export const createBirthdayEditionSchema = z.strictObject({
  age: z.number().int().min(THEME_MIN_AGE).max(THEME_MAX_AGE),
});
export type CreateBirthdayEditionInput = z.output<typeof createBirthdayEditionSchema>;
