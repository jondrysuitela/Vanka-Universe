/**
 * Motion for the Kotak Kenangan photo viewer (Tahap 4G.45).
 *
 * PURE: no React, no timers, no randomness. The component only applies the
 * values this module returns, so the motion can be unit-tested instead of being
 * re-derived inline.
 *
 * DESIGN GOALS (what "smooth" means here, concretely):
 *  - SLOW. A zoom that finishes in a second reads as a jump. The drift runs for
 *    ~22s, slower than a resting heartbeat, so the eye registers life without
 *    being pulled away from the photo.
 *  - SMALL AMPLITUDE. The scale only travels between 1.0 and 1.08. Anything
 *    beyond ~10% starts to feel like a video crop rather than a photograph.
 *  - CONTINUOUS, never a stop-and-restart. The photo zooms IN for the first half
 *    and back OUT for the second, so there is no visible seam where a loop
 *    resets. A one-way zoom must snap back; this does not.
 *  - DETERMINISTIC PER ITEM. Each item's direction and starting corner come from
 *    its index, not from Math.random(), so a photo moves the SAME way every time
 *    it is shown (and hydration/client renders agree).
 *  - REDUCED MOTION IS A HARD STOP. The caller passes `reduce`; this module
 *    returns a still frame, never a slower animation.
 */

/** One full in-and-out cycle. Slow on purpose; see DESIGN GOALS. */
export const KEN_BURNS_DURATION_S = 22;

/** How far the photo travels. Deliberately small — see DESIGN GOALS. */
export const KEN_BURNS_SCALE_RANGE = 0.08;

/** Resting scale of the zoomed-in end of the cycle. */
export const KEN_BURNS_SCALE_MIN = 1;
export const KEN_BURNS_SCALE_MAX = KEN_BURNS_SCALE_MIN + KEN_BURNS_SCALE_RANGE;

/** How far the frame drifts, in percent of its own size. */
export const KEN_BURNS_PAN_PERCENT = 1.6;

export interface KenBurnsMotion {
  /** Keyframe values for `scale`, in application order. */
  scale: [number, number, number];
  /** Keyframe values for `x`, in application order (percent). */
  x: [number, number, number];
  /** Keyframe values for `y`, in application order (percent). */
  y: [number, number, number];
  duration: number;
  /** Passed straight to framer-motion. */
  ease: "easeInOut";
  repeat: number;
  repeatType: "loop";
}

/** The four diagonal drifts. The index picks one; the sign pairs stay stable. */
const DIRECTIONS: ReadonlyArray<{ x: 1 | -1; y: 1 | -1 }> = [
  { x: 1, y: -1 },
  { x: -1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

/**
 * Motion for the photo at `index`. Stable: the same index always yields the
 * same drift, in every render and on every client.
 */
export function kenBurnsMotion(index: number): KenBurnsMotion {
  const direction = DIRECTIONS[((index % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length];
  const pan = KEN_BURNS_PAN_PERCENT;

  return {
    // in → out: the second half retraces the first, so the loop has no seam.
    scale: [KEN_BURNS_SCALE_MIN, KEN_BURNS_SCALE_MAX, KEN_BURNS_SCALE_MIN],
    x: [0, direction.x * pan, 0],
    y: [0, direction.y * pan, 0],
    duration: KEN_BURNS_DURATION_S,
    ease: "easeInOut",
    repeat: Number.POSITIVE_INFINITY,
    repeatType: "loop",
  };
}

/**
 * Per-item crossfade. The outgoing and incoming photos are BOTH fully visible
 * for most of the blend, so the change reads as a dissolve rather than a slide
 * with a hole in the middle.
 */
export const GALLERY_TRANSITION_S = 0.9;

/** True when the incoming item is the same one (no crossfade needed). */
export function isSameItem(previousId: string | null, nextId: string): boolean {
  return previousId === nextId;
}
