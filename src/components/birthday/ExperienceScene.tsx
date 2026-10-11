"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import LetterScene, { type LetterDraft, type LetterThumbnail } from "./LetterScene";

/**
 * Experience flow:
 *   0. Opening — thumbnail photo frame (real photo if chosen, else honest placeholder)
 *   1. A Letter From Ayah — six cinematic sections
 *   2. Kotak Kenangan — second box; opening it reveals the gallery
 *   3. A Universe of Love — closing message
 */
export const SCENE_COUNT = 4;

/** Index of the letter scene (used to land preview straight on the letter). */
export const LETTER_SCENE_INDEX = 1;

export const SCENE_LABELS = [
  "The Beginning",
  "A Letter From Ayah",
  "Kotak Kenangan",
  "A Universe of Love",
] as const;

interface ExperienceSceneProps {
  active: number;
  onNext: () => void;
  onPrev: () => void;
  onRestart: () => void;
  letterDraft?: LetterDraft;
  letterPreview?: boolean;
  thumbnail?: LetterThumbnail;
}

/* ---------------------------------------------------------------------------
 * Gallery media for the memory box.
 *
 * Replace the items below with real local assets placed in `public/`, e.g.:
 *   { kind: "image", src: "/media/vanka-first-smile.jpg", alt: "Vanka's first smile", caption: "First smile" }
 *   { kind: "video", src: "/media/vanka-first-laugh.mp4",  alt: "Vanka's first laugh on video", caption: "First laugh" }
 *
 * The "empty" kind renders an honest cosmic placeholder — it never claims to
 * be a real photo of Vanka. Uploaded (private) media is NOT wired in here.
 * ------------------------------------------------------------------------- */

type GalleryKind = "image" | "video" | "empty";

interface GalleryItem {
  kind: GalleryKind;
  alt: string;
  src?: string;
  caption?: string;
}

const GALLERY: GalleryItem[] = [
  {
    kind: "empty",
    alt: "Tempat untuk foto Vanka yang akan diisi saat edisi ulang tahun diterbitkan",
    caption: "Foto & video tahun pertama Vanka akan hidup di sini.",
  },
];

/** Deterministic, lightweight star field (no randomness on first paint). */
function Stars({ count = 26 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37 + 11) % 100}%`,
        top: `${(i * 53 + 7) % 100}%`,
        size: 1 + ((i * 13) % 3),
        delay: ((i * 17) % 10) / 10,
        base: 0.4 + ((i * 29) % 50) / 100,
      })),
    [count],
  );

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {stars.map((star, i) => (
        <span
          key={i}
          className="star-twinkle absolute rounded-full bg-[#e9eeff]"
          style={
            {
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              "--star-base": star.base,
              animationDelay: `${star.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Renders the actual media for a frame: image, video, or the honest placeholder. */
function FrameMedia({ kind, src, alt }: { kind: GalleryKind; src?: string; alt: string }) {
  if (kind === "image" && src) {
    return <Image src={src} alt={alt} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />;
  }
  if (kind === "video" && src) {
    return (
      <div className="absolute inset-0 bg-black/60">
        <video
          src={src}
          controls
          preload="metadata"
          aria-label={alt}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <div className="cosmos-sky absolute inset-0" />
      <div className="cosmos-aurora-a absolute -left-1/4 top-0 h-[70%] w-[70%]" />
      <div className="cosmos-aurora-c absolute -right-1/4 bottom-0 h-[70%] w-[70%]" />
      <div className="cosmos-vignette absolute inset-0" />
      <Stars count={16} />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <span className="text-shadow font-script text-3xl text-[#f0d9a4]">
          “a frame for our little light”
        </span>
        <p className="font-serif text-sm leading-relaxed text-white/70">
          A place for Vanka&apos;s first-year photos and videos. This frame stays honest until a real
          memory fills it.
        </p>
      </div>
    </div>
  );
}

/**
 * Reusable photo frame. This is the single frame used for BOTH the opening
 * thumbnail and the gallery — the honest placeholder is not duplicated.
 */
function PhotoFrame({
  kind,
  src,
  alt,
  className,
  footer,
}: {
  kind: GalleryKind;
  src?: string;
  alt: string;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <figure
      className={`relative w-full overflow-hidden rounded-3xl border border-[#e9c67c]/25 ${className ?? ""}`}
    >
      <FrameMedia kind={kind} src={src} alt={alt} />
      {footer}
    </figure>
  );
}

function Gallery() {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();

  const item = GALLERY[index % GALLERY.length];
  const goPrev = () => setIndex((i) => (i - 1 + GALLERY.length) % GALLERY.length);
  const goNext = () => setIndex((i) => (i + 1) % GALLERY.length);

  const frameFade = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985 },
    animate: reduce ? { opacity: 1 } : { opacity: 1, scale: 1 },
  };

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-4">
      <motion.div
        key={`${item.kind}-${index}`}
        {...frameFade}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full"
      >
        <PhotoFrame
          kind={item.kind}
          src={item.src}
          alt={item.alt}
          className="aspect-[4/5] max-w-md sm:aspect-[16/9] sm:max-w-3xl"
          footer={
            <figcaption className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pb-4 pt-12 text-left">
              <p className="font-sans text-xs text-[#f6e3b2]">{item.caption ?? item.alt}</p>
              <p className="mt-0.5 font-sans text-[0.65rem] uppercase tracking-[0.25em] text-white/55">
                {index + 1} / {GALLERY.length}
              </p>
            </figcaption>
          }
        />
      </motion.div>

      <div className="flex w-full max-w-2xl items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={GALLERY.length <= 1}
          aria-label="Foto atau video sebelumnya"
          className="rounded-full border border-white/20 px-4 py-2 font-sans text-xs uppercase tracking-[0.18em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:opacity-35"
        >
          ← Prev
        </button>

        <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Thumbnail galeri">
          {GALLERY.map((g, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Tampilkan: ${g.caption ?? g.alt}`}
              aria-current={i === index ? "true" : undefined}
              className={`relative h-12 w-16 overflow-hidden rounded-lg border transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9c67c] ${
                i === index ? "border-[#e9c67c]/80" : "border-white/15 opacity-70 hover:opacity-100"
              }`}
            >
              {g.kind === "image" && g.src ? (
                <Image src={g.src} alt="" fill sizes="64px" className="object-cover" />
              ) : g.kind === "video" && g.src ? (
                <span className="flex h-full w-full items-center justify-center bg-[#0b1226] text-[#f6e3b2]">
                  ▶
                </span>
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#14264f] to-[#04060f] text-[#e9c67c]">
                  ✦
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={GALLERY.length <= 1}
          aria-label="Foto atau video berikutnya"
          className="rounded-full border border-white/20 px-4 py-2 font-sans text-xs uppercase tracking-[0.18em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:opacity-35"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

/** Deterministic star burst vectors for the memory box. */
const MEMORY_PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * Math.PI * 2;
  return { x: Math.cos(angle) * 170, y: Math.sin(angle) * 170, delay: (i % 6) * 0.05 };
});

/**
 * Second box ("Kotak Kenangan"). Opening it reveals the existing gallery with
 * its title and description. Reuses <Gallery /> — it does NOT auto-publish
 * uploads: only items already listed in GALLERY are shown.
 */
function MemoryBox({ onReadLetter, onRestart }: { onReadLetter: () => void; onRestart: () => void }) {
  const reduce = useReducedMotion();
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);

  function handleOpen() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    // Guarantees the gallery is reachable even with reduced motion.
    window.setTimeout(() => setOpened(true), reduce ? 150 : 1500);
  }

  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
          Kotak Kenangan
        </span>
        <h2 className="text-shadow-lg font-display text-2xl leading-snug text-[#f6e3b2] sm:text-4xl">
          {opened ? "Little Moments" : "Satu kenangan lagi menanti"}
        </h2>
        {!opened ? (
          <p className="max-w-md font-serif text-base italic text-white/75">
            Buka kotak ini untuk melihat galeri kenangan.
          </p>
        ) : (
          <p className="max-w-2xl font-serif text-base leading-relaxed text-white/70 sm:text-lg">
            Small memories of Vanka&apos;s first year, kept close and easy to reach.
          </p>
        )}
      </div>

      <AnimatePresence mode="wait">
        {!opened ? (
          <motion.div
            key="box"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-6"
          >
            <div aria-hidden="true" className="relative h-40 w-64 sm:h-48 sm:w-80" style={{ perspective: 900 }}>
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

              {!reduce &&
                opening &&
                MEMORY_PARTICLES.map((p, i) => (
                  <motion.span
                    key={i}
                    className="absolute left-1/2 top-[38%] h-1.5 w-1.5 rounded-full bg-[#f7e6bb]"
                    initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                    animate={{ opacity: [0, 1, 0], x: p.x, y: p.y, scale: [0, 1.4, 0] }}
                    transition={{ duration: 1.2, delay: p.delay, ease: "easeOut" }}
                  />
                ))}

              <div className="absolute inset-x-0 bottom-0 h-[68%] rounded-lg border border-[#e9c67c]/40 bg-gradient-to-b from-[#1b2f5e] via-[#0f1b3a] to-[#050a18] shadow-[0_32px_60px_-24px_rgba(0,0,0,0.95)]" />
              <div className="absolute inset-x-0 bottom-[30%] h-[6%] bg-gradient-to-r from-[#c99b53] via-[#f7e6bb] to-[#c99b53]" />

              <motion.div
                className="absolute inset-x-[-6%] top-[8%] z-10 h-[26%] origin-bottom"
                animate={opening ? { rotateX: reduce ? -20 : -150 } : { rotateX: 0 }}
                transition={{ duration: reduce ? 0 : 0.9, ease: "easeOut" }}
              >
                <div className="relative h-full w-full rounded-md border border-[#e9c67c]/60 bg-gradient-to-b from-[#2a4a8f] to-[#0d1834] shadow-[0_18px_30px_-16px_rgba(0,0,0,0.9)]">
                  <div className="absolute inset-x-0 top-1/2 h-[14%] -translate-y-1/2 bg-gradient-to-r from-[#c99b53] via-[#f7e6bb] to-[#c99b53]" />
                  <div className="absolute left-1/2 top-[70%] h-4 w-4 -translate-x-1/2 rounded-sm bg-[#fdf3d8] shadow-[0_0_12px_rgba(247,230,187,0.9)]" />
                </div>
              </motion.div>
            </div>

            <button
              type="button"
              onClick={handleOpen}
              disabled={opening}
              aria-label="Buka kotak kenangan dan lihat galeri"
              className="inline-flex items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-9 py-4 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {opening ? "Membuka…" : "Buka Kenangan"}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="gallery"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.7, ease: "easeOut" }}
            className="flex w-full flex-col items-center"
          >
            <Gallery />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onReadLetter}
          className="inline-flex items-center justify-center gap-3 rounded-full border border-[#e9c67c]/45 px-7 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-[#f6e3b2] transition duration-300 hover:border-[#e9c67c] hover:text-[#fdf3d8] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          ← Kembali membaca surat
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center justify-center gap-3 rounded-full border border-white/25 px-7 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-white/75 transition duration-300 hover:border-white/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Kembali ke awal
        </button>
      </div>
    </div>
  );
}

export default function ExperienceScene({
  active,
  onNext,
  onPrev,
  onRestart,
  letterDraft,
  letterPreview,
  thumbnail,
}: ExperienceSceneProps) {
  const reduce = useReducedMotion();

  const frame = thumbnail ?? {
    alt: "Bingkai foto pembuka Vanka",
    caption: "Belum ada foto pembuka yang dipilih.",
  };

  const fade = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.99 },
    animate: reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.99 },
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onPrev();
    }
  };

  return (
    <div
      role="group"
      aria-label={`Scene ${active + 1} of ${SCENE_COUNT}: ${SCENE_LABELS[active]}`}
      onKeyDown={handleKeyDown}
      className="relative mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center px-6 py-20 sm:px-10"
    >
      {/* progress */}
      <div aria-hidden="true" className="absolute left-0 top-0 h-1 w-full bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-[#c99b53] to-[#f6e3b2] transition-all duration-700"
          style={{ width: `${((active + 1) / SCENE_COUNT) * 100}%` }}
        />
      </div>

      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          {active === 0 && (
            <motion.div key="scene-0" {...fade} transition={{ duration: 0.9, ease: "easeOut" }} className="flex w-full flex-col items-center gap-8 text-center">
              {/* Opening thumbnail frame — real photo if chosen, else honest placeholder */}
              <PhotoFrame
                kind={frame.src ? "image" : "empty"}
                src={frame.src}
                alt={frame.alt}
                className="aspect-[4/5] max-w-xs sm:aspect-[4/5] sm:max-w-sm"
              />
              <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-5 py-2 font-sans text-[0.68rem] font-medium uppercase tracking-[0.4em] text-[#f6e3b2] backdrop-blur-md">
                First Orbit · 27 October 2026
              </span>
              <h1 className="gold-glow bg-gradient-to-b from-[#fdf3d8] via-[#eecb8b] to-[#c99b53] bg-clip-text font-display text-5xl leading-[1.05] text-transparent sm:text-7xl">
                Vanka&apos;s First Universe
              </h1>
              <p className="font-serif text-xl italic text-white/85 sm:text-2xl">
                One year of light, laughter, and love.
              </p>
              <button
                type="button"
                onClick={onNext}
                className="mt-4 inline-flex items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98]"
              >
                Buka Surat
              </button>
              <p className="font-sans text-xs uppercase tracking-[0.3em] text-white/45">
                Keyboard: use arrow keys to move between scenes
              </p>
            </motion.div>
          )}

          {active === 1 && (
            <motion.div key="scene-1" {...fade} transition={{ duration: 0.9, ease: "easeOut" }} className="flex w-full flex-col items-center gap-8 text-center">
              <LetterScene draft={letterDraft} preview={letterPreview} onFinish={onNext} />
            </motion.div>
          )}

          {active === 2 && (
            <motion.div key="scene-2" {...fade} transition={{ duration: 0.9, ease: "easeOut" }} className="flex w-full flex-col items-center gap-8 text-center">
              <MemoryBox onReadLetter={onPrev} onRestart={onRestart} />
            </motion.div>
          )}

          {active === 3 && (
            <motion.div key="scene-3" {...fade} transition={{ duration: 0.9, ease: "easeOut" }} className="flex w-full flex-col items-center gap-8 text-center">
              <span className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
                A Universe of Love
              </span>
              <h2 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-5xl">
                Happy First Birthday, Vanka
              </h2>
              <p className="font-serif text-lg leading-relaxed text-white/75 sm:text-xl">
                In your first year you taught the sky around us how to glow.
                Every laugh, every sleepy smile, every tiny step became a star —
                and this whole universe was built so that none of them would
                ever be forgotten.
              </p>
              <p className="text-shadow max-w-xl font-script text-2xl text-[#f0d9a4] sm:text-3xl">
                {"For every chapter of your life, my love will always be here."}
              </p>
              <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                <button
                  type="button"
                  onClick={onRestart}
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-[#e9c67c]/45 px-7 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-[#f6e3b2] transition duration-300 hover:border-[#e9c67c] hover:text-[#fdf3d8] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
                >
                  Relive It From the Start
                </button>
                <Link
                  href="/"
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-white/25 px-7 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-white/75 transition duration-300 hover:border-white/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  Back to the Universe
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* controls + indicator */}
      <div className="mt-10 flex w-full max-w-md items-center justify-between gap-4">
        <button
          type="button"
          onClick={onPrev}
          disabled={active === 0}
          aria-label="Previous scene"
          className="rounded-full border border-white/20 px-5 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35"
        >
          ← Previous
        </button>

        <div className="flex items-center gap-2" role="navigation" aria-label="Scene indicator">
          {SCENE_LABELS.map((label, i) => (
            <span
              key={label}
              aria-hidden="true"
              className={`h-2 rounded-full transition-all duration-500 ${
                i === active ? "w-7 bg-gradient-to-r from-[#c99b53] to-[#f6e3b2]" : "w-2 bg-white/25"
              }`}
            />
          ))}
          <span className="sr-only">
            Scene {active + 1} of {SCENE_COUNT}
          </span>
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={active === SCENE_COUNT - 1}
          aria-label="Next scene"
          className="rounded-full border border-white/20 px-5 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
