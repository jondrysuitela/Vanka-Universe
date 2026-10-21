/**
 * Which byte route the birthday gallery must use (Tahap 4G.44).
 *
 * WHY THIS IS A SEPARATE, PURE MODULE:
 *   The gallery needs TWO different byte routes:
 *     - PUBLIC  — `/api/birthday/gallery/media/[id]`: date-gated, serves only
 *                 media whose cycle has already been revealed. This is what a
 *                 public visitor must see.
 *     - ADMIN   — `/api/media/[id]`: needs the admin session cookie and is NOT
 *                 date-gated. The admin must see the media BEFORE the birthday.
 *
 *   Choosing the wrong one fails in opposite ways: a visitor hitting the admin
 *   route gets a broken image (no session), and an admin hitting the public
 *   route sees an empty box (the reveal gate is still closed).
 *
 * A PREVIOUS BUG (fixed here): the page kept the builder in state and set it
 * with the updater form — `setMediaSrc((id) => `/api/media/${id}`)`. React
 * treats a function argument as an UPDATER: it calls it with the current state
 * and stores the RETURN value. The state therefore became the literal string
 * "/api/media/undefined" instead of a function, and `getMediaUrl(item.id)`
 * threw "getMediaUrl is not a function" in the admin preview.
 *
 * Keeping the decision here — as a plain string, with the builder derived from
 * it — makes the mistake impossible: nothing stores a function in state.
 */

/** Which byte route the gallery uses. */
export type ExperienceMediaRoute = "public" | "admin";

/**
 * The route for an experience mode.
 *
 * `adminDraft` is the admin preview (the browser-local draft mode). Everything
 * else — a public visitor — uses the date-gated public route.
 */
export function resolveMediaRoute(adminDraft: boolean): ExperienceMediaRoute {
  return adminDraft ? "admin" : "public";
}

/**
 * The byte URL of one gallery item on the given route.
 *
 * This is the SINGLE source of truth for both gallery byte routes. The public
 * one is also used by the admin letter thumbnail rewriter
 * (`letters/public-view.ts`), so the two can never drift apart.
 */
export function mediaUrlFor(route: ExperienceMediaRoute, id: string): string {
  return route === "admin" ? `/api/media/${id}` : `/api/birthday/gallery/media/${id}`;
}
