"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Full-screen glitter burst used as the transition when a box/letter opens.
 *
 * WHY A SHARED COMPONENT: the gift box, the letter envelope and the memory box
 * all switch from "closed" to "revealed". Each used to cut or fade in place;
 * this gives all three the same screen-filling glitter transition instead of
 * three slightly different ones.
 *
 * DETERMINISTIC: every particle position/vector comes from a seeded PRNG, so
 * the server and the client render the same field (no hydration mismatch) and
 * the effect never looks randomly different between openings.
 *
 * Reduced motion: no particles and no flash — just a short gold wash, then gone.
 */

/** Small seeded PRNG (same idea as `CosmicBackdrop`). */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spark {
  /** Starting angle, in radians, around the viewport centre. */
  angle: number;
  /** Distance the spark travels, in `vmax` units. */
  distance: number;
  /** Perpendicular jitter so the burst is a cloud, not a perfect ring. */
  drift: number;
  size: number;
  delay: number;
  duration: number;
  /** Gold or white — avoids a flat single-colour field. */
  tone: "gold" | "white" | "warm";
}

function buildSparks(seed: number, count: number): Spark[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    return {
      angle,
      // sqrt keeps the density even across the disc instead of crowding the rim.
      distance: 28 + Math.sqrt(random()) * 78,
      drift: -14 + random() * 28,
      size: 1.5 + random() * 4.5,
      delay: random() * 0.35,
      duration: 1.1 + random() * 1.2,
      tone: random() < 0.55 ? "gold" : random() < 0.6 ? "warm" : "white",
    };
  });
}

const TONE_COLOR: Record<Spark["tone"], string> = {
  gold: "#e9c67c",
  warm: "#f7e6bb",
  white: "#f4f7ff",
};

export default function GlitterBurst({
  active,
  /** Matches the reveal animation of the caller (box ~1.5s, letter ~1.1s). */
  durationMs = 1600,
  seed = 0x56414e4b,
  count = 110,
}: {
  active: boolean;
  durationMs?: number;
  seed?: number;
  count?: number;
}) {
  const reduce = useReducedMotion();
  const sparks = useMemo(() => buildSparks(seed, count), [seed, count]);
  const seconds = durationMs / 1000;
  /**
   * Self-terminating.
   *
   * Callers flip `active` to true and never reset it (their `opening` state is
   * final), so this component must stop on its own. Without this the full-screen
   * layer stayed mounted — invisible, but still covering the page.
   */
  const [visible, setVisible] = useState(active);
  // Start/stop during render (React's "adjust state when a prop changes"
  // pattern) instead of inside the effect, which would cascade a render.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setVisible(active);
  }

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setVisible(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [active, durationMs]);

  if (!visible) return null;

  return (
    <div
      // Above the scenes, below the emergency dialogs (z-200 in the app).
      className="pointer-events-none fixed inset-0 z-[160] overflow-hidden"
      aria-hidden="true"
    >
      {/* The layer fades out on its own while the layer is still mounted. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0 }}
      >
          {/* Centre flash — the light the box opens into. */}
          <motion.div
            className="absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(253,243,216,0.92) 0%, rgba(233,198,124,0.42) 26%, rgba(233,198,124,0.10) 52%, rgba(233,198,124,0) 72%)",
            }}
            initial={{ opacity: 0, scale: 0.15 }}
            animate={
              reduce
                ? { opacity: [0, 0.5, 0.15], scale: 1 }
                : { opacity: [0, 0.85, 0.22], scale: [0.15, 1.05, 1.35] }
            }
            transition={{ duration: reduce ? 0.6 : 1.15, ease: "easeOut" }}
          />

          {/* Spark field, spreading out to the screen edges and fading. */}
          {!reduce &&
            sparks.map((spark, index) => {
              const x = Math.cos(spark.angle) * spark.distance;
              const y = Math.sin(spark.angle) * spark.distance;
              return (
                <motion.span
                  key={index}
                  className="absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: spark.size,
                    height: spark.size,
                    marginLeft: -spark.size / 2,
                    marginTop: -spark.size / 2,
                    backgroundColor: TONE_COLOR[spark.tone],
                    boxShadow: `0 0 ${spark.size * 3}px ${TONE_COLOR[spark.tone]}`,
                  }}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                  animate={{
                    x: [`0vmax`, `${x * 0.35}vmax`, `${x}vmax`, `${x + spark.drift}vmax`],
                    y: [`0vmax`, `${y * 0.35}vmax`, `${y}vmax`, `${y + spark.drift}vmax`],
                    opacity: [0, 1, 0.85, 0],
                    scale: [0.4, 1.1, 0.9, 0.2],
                  }}
                  transition={{
                    duration: Math.min(spark.duration, seconds),
                    delay: spark.delay,
                    ease: "easeOut",
                    times: [0, 0.25, 0.65, 1],
                  }}
                />
              );
            })}

          {/* Final warm wash so the transition never ends on a hard cut. */}
          <motion.div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(253,243,216,0.30) 0%, rgba(11,18,38,0) 65%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: reduce ? [0, 0.25, 0] : [0, 0.55, 0] }}
            transition={{ duration: seconds, ease: "easeInOut" }}
          />
      </motion.div>
    </div>
  );
}
