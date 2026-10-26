/**
 * Motion for the Kotak Kenangan photo viewer (Tahap 4G.45).
 *
 * PURE: no React, no timers, no randomness. The component only applies the
 * values this module returns, so the motion can be unit-tested instead of being
 * re-derived inline.
 *
 * DESIGN GOALS (what "smooth" means here, concretely):
 *  - SLOW. A zoom that finishes in a second reads as a jump. The cycle runs for
 *    ~22s, so the eye registers life without being pulled away from the photo.
 *  - SMALL AMPLITUDE. The default range is 8%; the gallery gives each photo a
 *    stable, slightly varied range so the movement remains noticeable.
 *  - CONTINUOUS, never a stop-and-restart. The photo zooms IN for the first half
 *    and back OUT for the second, so there is no visible seam where a loop
 *    resets. A one-way zoom must snap back; this does not.
 *  - PHOTO ONLY. The caller applies these values to the image element itself,
 *    keeping the scrapbook paper and frame stationary.
 *  - REDUCED MOTION IS A HARD STOP. The caller skips the animation entirely
 *    when reduced motion is requested.
 */

/** One full in-and-out cycle. Slow on purpose; see DESIGN GOALS. */
export const KEN_BURNS_DURATION_S = 22;

/** How far the photo travels. Deliberately small — see DESIGN GOALS. */
export const KEN_BURNS_SCALE_RANGE = 0.08;

/** Resting scale of the zoomed-in end of the cycle. */
export const KEN_BURNS_SCALE_MIN = 1;
export const KEN_BURNS_SCALE_MAX = KEN_BURNS_SCALE_MIN + KEN_BURNS_SCALE_RANGE;

export interface KenBurnsMotion {
  scale: [number, number, number];
  duration: number;
}

/** Zoom cycle for a photo; the caller supplies a stable per-photo zoom range. */
export function kenBurnsMotion(
  zoomRange = KEN_BURNS_SCALE_RANGE,
): KenBurnsMotion {
  return {
    scale: [KEN_BURNS_SCALE_MIN, KEN_BURNS_SCALE_MIN + zoomRange, KEN_BURNS_SCALE_MIN],
    duration: KEN_BURNS_DURATION_S,
  };
}

/**
 * Per-item crossfade. The outgoing and incoming photos are BOTH fully visible
 * for most of the blend, so the change reads as a dissolve rather than a slide
 * with a hole in the middle.
 */
export const GALLERY_TRANSITION_S = 1.5;

/** True when the incoming item is the same one (no crossfade needed). */
export function isSameItem(previousId: string | null, nextId: string): boolean {
  return previousId === nextId;
}
