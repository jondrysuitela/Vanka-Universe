"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface GiftBoxIntroProps {
  onOpen: () => void;
}

/** Deterministic star burst vectors — no randomness, so SSR/client match. */
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  return { x: Math.cos(angle) * 150, y: Math.sin(angle) * 150, delay: (i % 5) * 0.06 };
});

/**
 * Cinematic opening: a CSS-illustrated gift box that the visitor opens.
 * Purely interactive — never autoplays. Under `prefers-reduced-motion` the
 * decorative motion is skipped but the button and the reveal still work.
 */
export default function GiftBoxIntro({ onOpen }: GiftBoxIntroProps) {
  const reduce = useReducedMotion();
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);

  function handleOpen() {
    // Synchronous guard: blocks a second click in the same tick.
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    // A timer guarantees the story is reachable even if motion is reduced or
    // an animation never settles — the visitor can never get stuck.
    window.setTimeout(() => onOpen(), reduce ? 200 : 1700);
  }

  return (
    <section className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center justify-center gap-10 px-6 py-20 text-center">
      {/* Gift box illustration (decorative) */}
      <div aria-hidden="true" className="relative">
        <motion.div
          className="relative h-52 w-52 sm:h-64 sm:w-64"
          style={{ perspective: 900 }}
          animate={opening || reduce ? { y: 0 } : { y: [0, -8, 0] }}
          transition={
            opening || reduce
              ? { duration: 0.3 }
              : { duration: 4, repeat: Infinity, ease: "easeInOut" }
          }
        >
          {/* Golden light burst */}
          <motion.div
            className="pointer-events-none absolute left-1/2 top-[35%] h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[400px] sm:w-[400px]"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(247,230,187,0.95) 0%, rgba(233,198,124,0.35) 40%, rgba(233,198,124,0) 70%)",
            }}
            initial={false}
            animate={opening ? { opacity: 1, scale: 1.1 } : { opacity: 0, scale: 0.35 }}
            transition={{ duration: reduce ? 0 : 0.8, ease: "easeOut" }}
          />

          {/* Star particles (skipped entirely under reduced motion) */}
          {!reduce &&
            opening &&
            PARTICLES.map((p, i) => (
              <motion.span
                key={i}
                className="absolute left-1/2 top-[40%] h-1.5 w-1.5 rounded-full bg-[#f7e6bb]"
                initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: [0, 1.4, 0] }}
                transition={{ duration: 1.1, delay: p.delay, ease: "easeOut" }}
              />
            ))}

          {/* Box base */}
          <div className="absolute inset-x-0 bottom-0 h-[76%] rounded-lg border border-[#e9c67c]/40 bg-gradient-to-b from-[#1b2f5e] via-[#0f1b3a] to-[#050a18] shadow-[0_32px_60px_-24px_rgba(0,0,0,0.95)]" />

          {/* Vertical ribbon on the base — loosens as the box opens */}
          <motion.div
            className="absolute bottom-0 left-1/2 h-[76%] w-[13%] -translate-x-1/2 rounded-sm bg-gradient-to-b from-[#f7e6bb] to-[#c99b53]"
            style={{ transformOrigin: "top center" }}
            initial={false}
            animate={opening ? { opacity: 0.15, scaleY: 0.15 } : { opacity: 1, scaleY: 1 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
          />

          {/* Lid + bow: lifts and tilts back when opened */}
          <motion.div
            className="absolute inset-x-[-7%] top-[4%] z-10 h-[22%]"
            style={{ transformOrigin: "center bottom" }}
            initial={false}
            animate={
              opening
                ? reduce
                  ? { y: -14, rotateX: 0, rotateZ: 0, transformPerspective: 600 }
                  : { y: -74, rotateX: -36, rotateZ: -5, transformPerspective: 600 }
                : { y: 0, rotateX: 0, rotateZ: 0, transformPerspective: 600 }
            }
            transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }}
          >
            <div className="relative h-full w-full rounded-md border border-[#e9c67c]/60 bg-gradient-to-b from-[#2a4a8f] to-[#0d1834] shadow-[0_18px_30px_-16px_rgba(0,0,0,0.9)]">
              {/* Horizontal ribbon across the lid */}
              <div className="absolute inset-y-0 left-1/2 w-[11%] -translate-x-1/2 bg-gradient-to-b from-[#f7e6bb] to-[#c99b53]" />
              {/* Bow */}
              <div className="absolute -top-[34%] left-1/2 flex -translate-x-1/2 items-center">
                <span className="h-7 w-11 -rotate-[26deg] rounded-[50%] border border-[#e9c67c]/50 bg-gradient-to-br from-[#f7e6bb] to-[#c99b53]" />
                <span className="-ml-2 h-7 w-11 rotate-[26deg] rounded-[50%] border border-[#e9c67c]/50 bg-gradient-to-bl from-[#f7e6bb] to-[#c99b53]" />
                <span className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#fdf3d8] shadow-[0_0_12px_rgba(247,230,187,0.9)]" />
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      {/* Copy + action */}
      <div className="flex flex-col items-center gap-4">
        <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-5 py-2 font-sans text-[0.68rem] font-medium uppercase tracking-[0.4em] text-[#f6e3b2] backdrop-blur-md">
          27 October 2026
        </span>
        <h1 className="gold-glow bg-gradient-to-b from-[#fdf3d8] via-[#eecb8b] to-[#c99b53] bg-clip-text font-display text-4xl leading-[1.05] text-transparent sm:text-6xl">
          Vanka&apos;s First Universe
        </h1>
        <p className="max-w-md font-serif text-lg italic text-white/80 sm:text-xl">
          Something magical is waiting for you…
        </p>
        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          aria-label="Buka hadiah dan mulai cerita ulang tahun pertama Vanka"
          className="mt-2 inline-flex items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-9 py-4 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {opening ? "Membuka…" : "Buka Hadiah"}
        </button>
      </div>
    </section>
  );
}
