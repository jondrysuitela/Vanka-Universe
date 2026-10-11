import type { CSSProperties } from "react";

type Star = {
  x: number;
  y: number;
  size: number;
  base: number;
  delay: number;
  duration: number;
};

type GoldenMote = {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
};

/**
 * Deterministic PRNG so the server and the client render the exact same
 * star field (avoids hydration mismatches).
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nextRandom = mulberry32(0x56414e4b); // "VANK"

const STARS: Star[] = Array.from({ length: 150 }, () => ({
  x: nextRandom() * 100,
  y: nextRandom() * 100,
  size: 1 + nextRandom() * 2.4,
  base: 0.35 + nextRandom() * 0.65,
  delay: nextRandom() * 8,
  duration: 3.5 + nextRandom() * 6,
}));

const GOLDEN_MOTES: GoldenMote[] = Array.from({ length: 18 }, () => ({
  x: nextRandom() * 100,
  y: 35 + nextRandom() * 70,
  size: 1.5 + nextRandom() * 3,
  delay: nextRandom() * 14,
  duration: 14 + nextRandom() * 12,
  drift: -24 + nextRandom() * 48,
}));

/**
 * Fixed, full-viewport night sky: deep blue gradient, breathing aurora
 * blobs, twinkling stars and drifting golden particles. Purely CSS-driven,
 * so it works in server components too, and every animation is disabled
 * under prefers-reduced-motion (see globals.css).
 */
export default function CosmicBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="cosmos-sky absolute inset-0" />

      <div
        className="cosmos-aurora-a aurora-breathe"
        style={{
          top: "-10%",
          left: "-15%",
          width: "62vw",
          height: "52vh",
          animationDuration: "16s",
        }}
      />
      <div
        className="cosmos-aurora-b aurora-breathe"
        style={{
          top: "8%",
          right: "-18%",
          width: "58vw",
          height: "46vh",
          animationDuration: "21s",
          animationDelay: "-6s",
        }}
      />
      <div
        className="cosmos-aurora-c aurora-breathe"
        style={{
          bottom: "-14%",
          left: "22%",
          width: "66vw",
          height: "44vh",
          animationDuration: "25s",
          animationDelay: "-11s",
        }}
      />

      {STARS.map((star, index) => (
        <span
          key={`star-${index}`}
          className="star-twinkle absolute rounded-full bg-[#e9eeff]"
          style={
            {
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.base,
              "--star-base": star.base,
              animationDelay: `${star.delay}s`,
              animationDuration: `${star.duration}s`,
            } as CSSProperties
          }
        />
      ))}

      {GOLDEN_MOTES.map((mote, index) => (
        <span
          key={`mote-${index}`}
          className="gold-drift absolute rounded-full bg-[#f0d091]"
          style={
            {
              left: `${mote.x}%`,
              top: `${mote.y}%`,
              width: `${mote.size}px`,
              height: `${mote.size}px`,
              opacity: 0,
              "--drift": `${mote.drift}px`,
              animationDelay: `${mote.delay}s`,
              animationDuration: `${mote.duration}s`,
            } as CSSProperties
          }
        />
      ))}

      <div className="cosmos-vignette absolute inset-0" />
    </div>
  );
}
