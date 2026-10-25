"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import GlitterBurst from "./GlitterBurst";
import {
  BIRTHDAY_CELEBRATION_MS,
  countdownSecondsUntil,
  formatCountdown,
} from "@/lib/birthday/countdown";

const FIREWORKS = [
  { x: 16, y: 28, delay: 0.05, color: "#f6d77a" },
  { x: 83, y: 25, delay: 0.35, color: "#f3a6d2" },
  { x: 27, y: 62, delay: 0.7, color: "#a9c8ff" },
  { x: 74, y: 64, delay: 0.95, color: "#fff0c4" },
  { x: 50, y: 18, delay: 1.2, color: "#b6f5cd" },
] as const;

const FIREWORK_PARTICLES = Array.from({ length: 26 }, (_, index) => ({
  angle: (index / 26) * Math.PI * 2,
  distance: 58 + ((index * 37) % 66),
  size: index % 5 === 0 ? 5 : 3,
}));

const WAITING_FIREWORKS = [
  { x: 13, y: 30, delay: 0, color: "#f6d77a" },
  { x: 86, y: 34, delay: 2.1, color: "#c4a7ff" },
  { x: 74, y: 76, delay: 4.2, color: "#f3a6d2" },
] as const;

const WAITING_CONFETTI_COLORS = ["#f6d77a", "#f3a6d2", "#a9c8ff", "#b6f5cd"] as const;

export default function BirthdayCountdown({
  revealAt,
  now,
  onOpenGift,
  onClose,
}: {
  revealAt: number;
  now: number;
  onOpenGift: () => void;
  onClose?: () => void;
}) {
  const reduce = useReducedMotion();
  const [celebrationReady, setCelebrationReady] = useState(false);
  const celebrating = now >= revealAt;
  const seconds = countdownSecondsUntil(revealAt, now);

  useEffect(() => {
    if (!celebrating) return;
    const timer = window.setTimeout(
      () => setCelebrationReady(true),
      reduce ? 0 : BIRTHDAY_CELEBRATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [celebrating, reduce]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="birthday-countdown-title"
      className="fixed inset-0 z-[200] flex min-h-dvh items-center justify-center overflow-hidden bg-[#04060f] px-5 py-10 text-center"
    >
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup preview countdown"
          className="absolute right-5 top-5 z-20 rounded-full border border-white/20 bg-[#0b1226]/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#fdf3d8] backdrop-blur-md transition hover:border-[#e9c67c]/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          Tutup preview
        </button>
      )}
      <div aria-hidden="true" className="cosmos-sky absolute inset-0" />
      <div aria-hidden="true" className="cosmos-aurora-a absolute -top-32 left-[8%] h-[55vmin] w-[55vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-b absolute right-[4%] top-[30%] h-[45vmin] w-[45vmin]" />
      <div aria-hidden="true" className="cosmos-vignette absolute inset-0" />
      {celebrationReady && !reduce && (
        <div
          aria-hidden="true"
          data-testid="birthday-ambient-celebration"
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
        >
          {WAITING_FIREWORKS.map((firework) => (
            <div
              key={`${firework.x}-${firework.y}`}
              className="absolute h-0 w-0"
              style={{ left: `${firework.x}%`, top: `${firework.y}%` }}
            >
              <motion.span
                className="absolute -left-1 -top-1 h-2 w-2 rounded-full"
                style={{
                  backgroundColor: firework.color,
                  boxShadow: `0 0 16px 5px ${firework.color}`,
                }}
                animate={{ scale: [0.2, 1.2, 0.1], opacity: [0, 0.8, 0] }}
                transition={{
                  duration: 1.1,
                  delay: firework.delay,
                  repeat: Infinity,
                  repeatDelay: 5.4,
                  ease: "easeOut",
                }}
              />
              {Array.from({ length: 12 }, (_, index) => {
                const angle = (index / 12) * Math.PI * 2;
                const distance = 26 + ((index * 13) % 28);
                return (
                  <motion.span
                    key={index}
                    className="absolute h-1 w-1 rounded-full"
                    style={{
                      backgroundColor: firework.color,
                      boxShadow: `0 0 8px 2px ${firework.color}`,
                    }}
                    animate={{
                      x: [0, Math.cos(angle) * distance],
                      y: [0, Math.sin(angle) * distance],
                      opacity: [0, 0.8, 0],
                      scale: [0.2, 1, 0.1],
                    }}
                    transition={{
                      duration: 1.2,
                      delay: firework.delay,
                      repeat: Infinity,
                      repeatDelay: 5.3,
                      ease: "easeOut",
                    }}
                  />
                );
              })}
            </div>
          ))}
          {Array.from({ length: 18 }, (_, index) => (
            <motion.span
              key={index}
              className="absolute top-0 h-2 w-1 rounded-sm"
              style={{
                left: `${(index * 47 + 9) % 100}%`,
                backgroundColor: WAITING_CONFETTI_COLORS[index % WAITING_CONFETTI_COLORS.length],
              }}
              animate={{
                y: ["-5vh", "105vh"],
                x: [0, index % 2 === 0 ? 18 : -18, 0],
                rotate: [0, 180, 360],
                opacity: [0, 0.55, 0.45, 0],
              }}
              transition={{
                duration: 8 + (index % 5),
                delay: (index % 9) * 0.8,
                repeat: Infinity,
                ease: "linear",
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
        <p className="font-sans text-[0.65rem] font-semibold uppercase tracking-[0.4em] text-[#e9c67c] sm:text-xs">
          Vanka&apos;s First Universe
        </p>

        <motion.div
          aria-hidden="true"
          className="relative mt-8 w-full max-w-[19rem] sm:max-w-[22rem]"
          animate={reduce ? undefined : { y: [0, -8, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.div
            className="absolute -inset-10 rounded-full"
            animate={reduce ? undefined : { opacity: [0.28, 0.58, 0.28], scale: [0.92, 1.08, 0.92] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background:
                "radial-gradient(circle, rgba(233,198,124,0.28) 0%, rgba(139,92,246,0.12) 42%, transparent 72%)",
              filter: "blur(18px)",
            }}
          />
          <svg viewBox="0 0 360 270" className="relative w-full drop-shadow-[0_20px_35px_rgba(0,0,0,0.45)]">
            <defs>
              <linearGradient id="cake-plate" x1="0" x2="1">
                <stop offset="0" stopColor="#b88646" />
                <stop offset="0.5" stopColor="#fff0c4" />
                <stop offset="1" stopColor="#bd8b48" />
              </linearGradient>
              <linearGradient id="cake-icing" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff0cf" />
                <stop offset="1" stopColor="#dcae73" />
              </linearGradient>
              <linearGradient id="cake-base" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#913d70" />
                <stop offset="1" stopColor="#452454" />
              </linearGradient>
              <linearGradient id="cake-top" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f6d6e6" />
                <stop offset="1" stopColor="#c47b9e" />
              </linearGradient>
              <linearGradient id="candle" x1="0" x2="1">
                <stop offset="0" stopColor="#e6bd69" />
                <stop offset="0.5" stopColor="#fff2c6" />
                <stop offset="1" stopColor="#c88d49" />
              </linearGradient>
              <filter id="flame-glow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <ellipse cx="180" cy="236" rx="126" ry="16" fill="url(#cake-plate)" opacity="0.94" />
            <ellipse cx="180" cy="229" rx="108" ry="11" fill="#fdf3d8" opacity="0.85" />
            <path d="M80 157h200v49c0 17-17 29-38 29h-124c-21 0-38-12-38-29z" fill="url(#cake-base)" />
            <ellipse cx="180" cy="157" rx="100" ry="25" fill="url(#cake-top)" />
            <path d="M80 158c16 11 25 4 37 13s22 5 32 14 22 5 31-2 19-7 29 0 22 7 32-3 22-11 39-3v-20z" fill="url(#cake-icing)" />
            <path d="M90 191c12 7 20 3 29 10s18 5 27 0 18-5 27 1 20 5 28-1 18-7 27-1 18 5 30-2" fill="none" stroke="#f8d9a0" strokeWidth="4" strokeLinecap="round" opacity="0.82" />
            <circle cx="119" cy="177" r="4" fill="#f4d78e" />
            <circle cx="242" cy="181" r="4" fill="#f4d78e" />
            <circle cx="174" cy="209" r="4" fill="#f4d78e" />
            <circle cx="205" cy="166" r="3" fill="#fff0c4" />

            {[151, 180, 209].map((x, index) => (
              <g key={x}>
                <rect x={x - 7} y="105" width="14" height="46" rx="5" fill="url(#candle)" />
                <path d={`M${x} 105v-6`} stroke="#39253b" strokeWidth="2" strokeLinecap="round" />
                {celebrating ? (
                  <g>
                    <motion.path
                      d={`M${x} 97c-10-8 8-13 1-25 15 10 13 20-1 25z`}
                      fill="#e8edf6"
                      opacity="0.55"
                      animate={reduce ? { opacity: 0 } : { y: -17, x: index % 2 ? 4 : -4, opacity: [0.55, 0.35, 0] }}
                      transition={{ duration: 2.2, ease: "easeOut" }}
                    />
                    <motion.circle
                      cx={x}
                      cy="95"
                      r="2"
                      fill="#fff0c4"
                      animate={{ opacity: [0, 0.9, 0], scale: [0.4, 1.5, 0.2] }}
                      transition={{ duration: 0.9, delay: index * 0.18 }}
                    />
                  </g>
                ) : (
                  <motion.path
                    d={`M${x} 97c-11-10 8-16 1-29 16 11 13 22-1 29z`}
                    fill="#ffd36e"
                    filter="url(#flame-glow)"
                    animate={reduce ? undefined : { scale: [0.9, 1.08, 0.94], rotate: [-4, 4, -2] }}
                    style={{ transformOrigin: `${x}px 96px` }}
                    transition={{ duration: 0.8 + index * 0.12, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </g>
            ))}
          </svg>
        </motion.div>

        <motion.div
          key={celebrating ? "celebrating" : "countdown"}
          initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.7, ease: "easeOut" }}
          className="mt-5 flex flex-col items-center"
          aria-live="polite"
        >
          <h1
            id="birthday-countdown-title"
            className="font-display text-2xl text-[#fdf3d8] sm:text-4xl"
          >
            {celebrating ? "Jam dua belas tepat!" : "Menuju ulang tahun Vanka"}
          </h1>
          <p className="mt-3 font-serif text-sm text-white/70 sm:text-base">
            {celebrating
              ? "Lilin padam. Semesta menyala untukmu."
              : "Sebuah semesta kecil sedang menunggu untuk dibuka."}
          </p>
          {!celebrating ? (
            <motion.p
              key={seconds}
              className="mt-5 font-display text-5xl tabular-nums text-[#f6d77a] sm:text-6xl"
              initial={reduce ? undefined : { opacity: 0.6, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              {formatCountdown(seconds)}
            </motion.p>
          ) : (
            <p className="mt-5 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-[#f6d77a] sm:text-xs">
              27 Oktober · 00.00 WIT
            </p>
          )}
        </motion.div>

        {celebrating && (
          <>
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1]"
              initial={{ opacity: 0 }}
              animate={
                reduce
                  ? { opacity: 0.16 }
                  : { opacity: [0, 0.78, 0.12, 0.48, 0.08, 0.3, 0] }
              }
              transition={{ duration: 3.6, ease: "easeOut" }}
              style={{
                background:
                  "radial-gradient(ellipse at 50% 42%, rgba(255,248,220,0.9) 0%, rgba(246,215,122,0.38) 18%, rgba(139,92,246,0.28) 42%, rgba(4,6,15,0) 76%)",
              }}
            />
            {!reduce &&
              FIREWORKS.map((firework, burstIndex) => (
                <div
                  key={`${firework.x}-${firework.y}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
                >
                  <motion.div
                    className="absolute h-2 w-2 rounded-full"
                    style={{
                      left: `${firework.x}%`,
                      top: `${firework.y}%`,
                      backgroundColor: firework.color,
                      boxShadow: `0 0 22px 8px ${firework.color}`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: [0, 1.8, 0.1], opacity: [0, 1, 0] }}
                    transition={{
                      duration: 1.15,
                      delay: firework.delay,
                      ease: "easeOut",
                    }}
                  />
                  <motion.div
                    className="absolute h-4 w-4 rounded-full border-2"
                    style={{
                      left: `${firework.x}%`,
                      top: `${firework.y}%`,
                      borderColor: firework.color,
                      boxShadow: `0 0 26px ${firework.color}`,
                    }}
                    initial={{ x: -8, y: -8, scale: 0, opacity: 0 }}
                    animate={{
                      x: -8,
                      y: -8,
                      scale: [0.1, 7, 12],
                      opacity: [0, 0.9, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      delay: firework.delay,
                      ease: "easeOut",
                    }}
                  />
                  {FIREWORK_PARTICLES.map((particle, index) => (
                    <motion.span
                      key={index}
                      className="absolute rounded-full"
                      style={{
                        left: `${firework.x}%`,
                        top: `${firework.y}%`,
                        width: particle.size,
                        height: particle.size,
                        backgroundColor: firework.color,
                        boxShadow: `0 0 12px 2px ${firework.color}`,
                      }}
                      initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
                      animate={{
                        x: Math.cos(particle.angle) * particle.distance,
                        y: Math.sin(particle.angle) * particle.distance,
                        scale: [0.2, 1.2, 0.1],
                        opacity: [0, 1, 0],
                      }}
                      transition={{
                        duration: 1.35 + (index % 4) * 0.12,
                        delay: firework.delay + (index % 3) * 0.025,
                        ease: "easeOut",
                      }}
                    />
                  ))}
                  {burstIndex === 0 && (
                    <span className="sr-only">Kembang api merayakan ulang tahun Vanka</span>
                  )}
                </div>
              ))}
            <GlitterBurst active durationMs={BIRTHDAY_CELEBRATION_MS} seed={0x27102026} count={150} />
            <motion.div
              key="midnight-celebration-title"
              initial={reduce ? { opacity: 1 } : { opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: reduce ? 0 : 0.35, duration: reduce ? 0 : 1.05, ease: "easeOut" }}
              className="relative z-10 mt-6 flex flex-col items-center"
            >
              <p className="mb-3 rounded-full border border-[#f6d77a]/45 bg-[#0b1226]/65 px-4 py-1.5 font-sans text-[0.58rem] font-bold uppercase tracking-[0.38em] text-[#f6d77a] shadow-[0_0_28px_-8px_rgba(246,215,122,0.8)] sm:text-[0.68rem]">
                A new orbit begins
              </p>
              <h2 className="bg-gradient-to-b from-white via-[#fff0c4] to-[#e9c67c] bg-clip-text font-display text-3xl leading-tight text-transparent drop-shadow-[0_0_28px_rgba(246,215,122,0.55)] sm:text-5xl">
                Selamat Ulang Tahun,
                <span className="mt-1 block text-4xl sm:text-6xl">Vanka ✨</span>
              </h2>
              <p className="mt-4 max-w-md font-serif text-sm leading-relaxed text-white/85 sm:text-base">
                Satu tahun pertama di antara bintang dimulai. Seluruh semesta merayakanmu.
              </p>
            </motion.div>
            {celebrationReady && (
              <motion.button
                type="button"
                onClick={onOpenGift}
                initial={reduce ? { opacity: 1 } : { opacity: 0, y: 22, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: reduce ? 0 : 0.75, ease: "easeOut" }}
                className="relative z-10 mt-7 inline-flex items-center justify-center gap-3 rounded-full border border-[#fff0c4]/80 bg-gradient-to-b from-white via-[#f6d77a] to-[#bd8b48] px-10 py-4 font-sans text-xs font-bold uppercase tracking-[0.24em] text-[#241809] shadow-[0_0_70px_-10px_rgba(246,215,122,1)] transition hover:scale-[1.04] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#fdf3d8] sm:text-sm"
              >
                <span aria-hidden="true">✦</span>
                Buka Kado Vanka
                <span aria-hidden="true">✦</span>
              </motion.button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
