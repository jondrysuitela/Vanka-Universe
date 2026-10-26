"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import BirthdayAmbientEffects from "./BirthdayAmbientEffects";
import GlitterBurst from "./GlitterBurst";
import LetterScene, { type LetterDraft, type LetterThumbnail } from "./LetterScene";
import type { GalleryItem } from "@/lib/birthday/gallery/client-sync";
import { mediaUrlFor } from "@/lib/birthday/experience-media";
import { GALLERY_TRANSITION_S, kenBurnsMotion } from "@/lib/birthday/ken-burns";

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
  /**
   * Real birthday-gallery media, oldest first, when a cycle is revealed (or on
   * admin preview). When undefined/empty the gallery keeps the honest cosmic
   * placeholder — it never claims to be a real photo of Vanka.
   */
  galleryItems?: GalleryItem[];
  /**
   * Byte-URL builder for one gallery item. Defaults to the PUBLIC revealed
   * route. Admin preview (before the reveal) must pass the ADMIN route
   * `/api/media/[id]`, which needs the session cookie and bypasses the date
   * gate.
   */
  mediaSrc?: (id: string) => string;
}

/* ---------------------------------------------------------------------------
 * Gallery media for the memory box.
 *
 * Items arrive from the engine (see `client-sync.ts` + the gallery API). The
 * bytes are streamed through `/api/birthday/gallery/media/[id]`, which only
 * serves media whose cycle has been revealed. No placeholder below ever claims
 * to be a real photo of Vanka.
 * ------------------------------------------------------------------------- */

type GalleryKind = "image" | "video" | "empty";

/** Item used when there is no real media yet — the honest cosmic placeholder. */
const PLACEHOLDER_ITEM: GalleryItem = {
  id: "placeholder",
  kind: "image",
  mime: "",
  name: "",
  title: "Tempat untuk foto Vanka yang akan diisi saat edisi ulang tahun diterbitkan",
  description: "Foto & video tahun pertama Vanka akan hidup di sini.",
  takenAt: null,
  createdAt: "",
};

/** Public byte URL for one revealed gallery item. */
export function galleryMediaUrl(id: string): string {
  return mediaUrlFor("public", id);
}

/** Caption shown under a frame: the admin title, else the file name. */
function itemCaption(item: GalleryItem): string {
  return item.title?.trim() || item.name;
}

/** Stable per-photo seed for varied zoom amount, origin and starting phase. */
function photoMotionIndex(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

const SCRAPBOOK_FRAMES = [
  {
    id: "tape-top",
    src: "/scrapbook/frame-tape-top.png",
    aperture: { left: "14.3%", top: "15.6%", width: "67.7%", height: "57.5%" },
  },
  {
    id: "tape-corner",
    src: "/scrapbook/frame-tape-corner.png",
    aperture: { left: "15.9%", top: "16.1%", width: "66%", height: "57.2%" },
  },
  {
    id: "polaroid",
    src: "/scrapbook/frame-polaroid.png",
    aperture: { left: "10.4%", top: "12.3%", width: "78.1%", height: "62.6%" },
  },
] as const;

const SCRAPBOOK_CARD_POSITIONS = {
  active: { left: "21%", top: "4%", scale: 1, rotate: 0, zIndex: 100, opacity: 1, blur: 0 },
  next: { left: "49%", top: "15%", scale: 0.7, rotate: 9, zIndex: 72, opacity: 0.88, blur: 1 },
  previous: { left: "-1%", top: "18%", scale: 0.68, rotate: -10, zIndex: 70, opacity: 0.84, blur: 1 },
  nextTwo: { left: "10%", top: "35%", scale: 0.66, rotate: 6, zIndex: 52, opacity: 0.78, blur: 1.5 },
  previousTwo: { left: "44%", top: "32%", scale: 0.64, rotate: -7, zIndex: 50, opacity: 0.74, blur: 1.5 },
} as const;

function scrapbookCardPosition(offset: number) {
  if (offset === 0) return SCRAPBOOK_CARD_POSITIONS.active;
  if (offset === 1) return SCRAPBOOK_CARD_POSITIONS.next;
  if (offset === -1) return SCRAPBOOK_CARD_POSITIONS.previous;
  if (offset === 2) return SCRAPBOOK_CARD_POSITIONS.nextTwo;
  if (offset === -2) return SCRAPBOOK_CARD_POSITIONS.previousTwo;

  const depth = Math.abs(offset);
  const stackDepth = depth - 3;
  const side = Math.sign(offset);
  const horizontalJitter = ((stackDepth % 5) - 2) * 1.5 + side * 2;

  return {
    left: `${20 + horizontalJitter}%`,
    top: `${12 + Math.min(stackDepth, 6) * 1.2 + side}%`,
    scale: Math.max(0.5, 0.62 - stackDepth * 0.004),
    rotate: (stackDepth % 7) - 3,
    zIndex: 40 - depth,
    opacity: Math.max(0.28, 0.66 - stackDepth * 0.025),
    blur: Math.min(3, 1.8 + stackDepth * 0.08),
  };
}

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
function FrameMedia({
  kind,
  src,
  alt,
  kenBurns = false,
  motionIndex = 0,
  zoomRange,
  imageFit = "cover",
}: {
  kind: GalleryKind;
  src?: string;
  alt: string;
  /**
   * Slow "Ken Burns" drift so a still photo does not feel frozen. Only the
   * memory-box gallery asks for it; the opening thumbnail stays still.
   */
  kenBurns?: boolean;
  /**
   * Stable per-photo seed that varies zoom strength, origin and starting phase.
   */
  motionIndex?: number;
  zoomRange?: number;
  imageFit?: "cover" | "contain";
}) {
  if (kind === "image" && src) {
    // `unoptimized` is REQUIRED here: every media URL is an API route
    // (`/api/media/[id]` for the admin preview, `/api/birthday/gallery/media/[id]`
    // in public). Next's image optimizer fetches such a URL internally with NO
    // cookies, so a session-gated route answers 401 and the frame stays empty.
    // Skipping the optimizer lets the BROWSER fetch it with the session cookie.
    const drift = kenBurns ? kenBurnsMotion(zoomRange) : undefined;
    const image = (
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 768px) 100vw, 50vw"
        className={`${imageFit === "contain" ? "object-contain" : "object-cover"}${kenBurns ? " memory-photo-ken-burns" : ""}`}
        style={
          drift
            ? ({
                "--ken-burns-scale": drift.scale[1],
                "--ken-burns-duration": `${drift.duration}s`,
                "--ken-burns-delay": `-${((motionIndex % 5) * 0.6)}s`,
                "--ken-burns-origin-x": `${30 + (motionIndex % 5) * 10}%`,
                "--ken-burns-origin-y": `${30 + ((motionIndex >>> 3) % 5) * 10}%`,
              } as CSSProperties)
            : undefined
        }
        unoptimized
      />
    );
    return image;
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
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <span className="text-shadow font-script text-[clamp(0.8rem,2.8vw,1.5rem)] leading-tight text-[#f0d9a4]">
          “a frame for our little light”
        </span>
        <p className="max-w-[24rem] font-serif text-[clamp(0.55rem,1.4vw,0.8rem)] leading-snug text-white/70">
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
  kenBurns,
  motionIndex,
  zoomRange,
  imageFit,
  unframed = false,
}: {
  kind: GalleryKind;
  src?: string;
  alt: string;
  className?: string;
  footer?: ReactNode;
  kenBurns?: boolean;
  motionIndex?: number;
  zoomRange?: number;
  imageFit?: "cover" | "contain";
  unframed?: boolean;
}) {
  return (
    <figure
      className={`relative w-full overflow-hidden ${unframed ? "" : "rounded-3xl border border-[#e9c67c]/25"} ${className ?? ""}`}
    >
      <FrameMedia
        kind={kind}
        src={src}
        alt={alt}
        kenBurns={kenBurns}
        motionIndex={motionIndex}
        zoomRange={zoomRange}
        imageFit={imageFit}
      />
      {footer}
    </figure>
  );
}

/**
 * A gallery frame mapped from engine items: real media bytes, or the honest
 * placeholder for the placeholder item. PhotoFrame stays shared with the
 * opening thumbnail.
 */
function GalleryFrame({
  item,
  className,
  footer,
  getMediaUrl,
  kenBurns,
  motionIndex,
  zoomRange,
  imageFit,
  unframed,
}: {
  item: GalleryItem;
  className?: string;
  footer?: ReactNode;
  getMediaUrl: (id: string) => string;
  kenBurns?: boolean;
  motionIndex?: number;
  zoomRange?: number;
  imageFit?: "cover" | "contain";
  unframed?: boolean;
}) {
  if (item.id === PLACEHOLDER_ITEM.id) {
    return (
      <PhotoFrame
        kind="empty"
        src={undefined}
        alt={item.title ?? ""}
        className={className}
        footer={footer}
        unframed={unframed}
      />
    );
  }
  return (
    <PhotoFrame
      kind={item.kind}
      src={getMediaUrl(item.id)}
      alt={itemCaption(item)}
      className={className}
      footer={footer}
      kenBurns={kenBurns}
      motionIndex={motionIndex}
      zoomRange={zoomRange}
      imageFit={imageFit}
      unframed={unframed}
    />
  );
}

/**
 * The memory-box gallery viewer. Renders engine items when present; otherwise
 * a single honest cosmic placeholder — it never claims a real photo exists.
 */
function Gallery({ items, getMediaUrl }: { items: GalleryItem[]; getMediaUrl: (id: string) => string }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const reduce = useReducedMotion();

  const list = items.length > 0 ? items : [PLACEHOLDER_ITEM];
  const visibleCards = list.map((item, itemIndex) => {
    const wrappedOffset = (itemIndex - index + list.length) % list.length;
    const offset = wrappedOffset > list.length / 2 ? wrappedOffset - list.length : wrappedOffset;
    return { item, itemIndex, offset };
  });
  const goPrev = () => {
    setDirection(-1);
    setIndex((i) => (i - 1 + list.length) % list.length);
  };
  const goNext = () => {
    setDirection(1);
    setIndex((i) => (i + 1) % list.length);
  };
  const goTo = (nextIndex: number) => {
    if (nextIndex === index) return;
    setDirection(nextIndex > index ? 1 : -1);
    setIndex(nextIndex);
  };

  return (
    <div className="flex w-full max-w-5xl flex-col items-center gap-4">
      <div
        data-testid="memory-scrapbook-stage"
        className="relative grid aspect-[4/5] w-full max-w-2xl place-items-center overflow-visible bg-transparent"
        style={{ perspective: 1400, isolation: "isolate" }}
      >
        <AnimatePresence initial={false} custom={direction}>
          {visibleCards.map(({ item, itemIndex, offset }) => {
            const position = scrapbookCardPosition(offset);
            const frame = SCRAPBOOK_FRAMES[itemIndex % SCRAPBOOK_FRAMES.length];
            const motionIndex = photoMotionIndex(item.id);
            const isActive = offset === 0;

            return (
              <motion.div
                key={item.id}
                custom={direction}
                initial={false}
                animate={{
                  left: position.left,
                  top: position.top,
                  scale: position.scale,
                  rotate: position.rotate,
                  opacity: position.opacity,
                  filter: `blur(${position.blur}px) drop-shadow(0 24px 28px rgba(0,0,0,0.5))`,
                }}
                exit={{ opacity: 0, x: direction * -120, rotate: position.rotate + direction * 12 }}
                transition={{
                  duration: reduce ? 0 : GALLERY_TRANSITION_S,
                  ease: [0.65, 0, 0.35, 1],
                }}
                data-testid={isActive ? "memory-scrapbook-photo" : "memory-scrapbook-print"}
                data-gallery-slot={offset}
                data-gallery-item-id={item.id}
                data-gallery-depth={Math.abs(offset)}
                data-blur-px={position.blur}
                data-transition-duration-ms={reduce ? 0 : GALLERY_TRANSITION_S * 1000}
                className="absolute top-0 aspect-[1200/1447] w-[58%] origin-center"
                style={{ zIndex: position.zIndex, transformPerspective: 1400 }}
              >
                <div
                  data-testid="memory-scrapbook-photo-window"
                  className="absolute overflow-hidden bg-[#17130f]"
                  style={{
                    left: frame.aperture.left,
                    top: frame.aperture.top,
                    width: frame.aperture.width,
                    height: frame.aperture.height,
                  }}
                >
                  <GalleryFrame
                    item={item}
                    getMediaUrl={getMediaUrl}
                    imageFit="cover"
                    unframed
                    kenBurns={item.kind === "image" && item.id !== PLACEHOLDER_ITEM.id && !reduce}
                    motionIndex={motionIndex}
                    zoomRange={0.1 + ((motionIndex >>> 4) % 6) * 0.01}
                    className="h-full w-full"
                  />
                </div>
                <Image
                  src={frame.src}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 58vw, 420px"
                  className="pointer-events-none z-10 object-fill"
                  data-testid="scrapbook-frame-art"
                  data-frame-asset={frame.id}
                />
                {item.id !== PLACEHOLDER_ITEM.id && (
                  <div className="pointer-events-none absolute inset-x-[10%] bottom-[4%] z-20 flex h-[17%] flex-col justify-center overflow-hidden text-[#514232]">
                    <p className="line-clamp-2 font-script text-[clamp(0.55rem,1.7vw,1.2rem)] leading-tight">
                      {itemCaption(item)}
                    </p>
                    <p className="mt-0.5 font-sans text-[clamp(0.35rem,0.8vw,0.55rem)] uppercase tracking-[0.2em] opacity-70">
                      {list.findIndex((photo) => photo.id === item.id) + 1} / {list.length}
                    </p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex w-full max-w-2xl items-center justify-between gap-3">
        <button
          type="button"
          onClick={goPrev}
          disabled={list.length <= 1}
          aria-label="Foto atau video sebelumnya"
          className="rounded-full border border-white/20 px-4 py-2 font-sans text-xs uppercase tracking-[0.18em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:opacity-35"
        >
          ← Prev
        </button>

        <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Thumbnail galeri">
          {list.map((g, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Tampilkan: ${itemCaption(g)}`}
              aria-current={i === index ? "true" : undefined}
              className={`relative h-12 w-16 overflow-hidden rounded-lg border transition duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e9c67c] ${
                i === index
                  ? "scale-110 border-[#e9c67c]/80 shadow-[0_0_18px_-4px_rgba(233,198,124,0.8)]"
                  : "border-white/15 opacity-70 hover:scale-105 hover:opacity-100"
              }`}
            >
              {g.id !== PLACEHOLDER_ITEM.id && g.kind === "image" ? (
                <Image
                  src={getMediaUrl(g.id)}
                  alt=""
                  fill
                  sizes="64px"
                  className="object-cover"
                  unoptimized
                />
              ) : g.id !== PLACEHOLDER_ITEM.id && g.kind === "video" ? (
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
          disabled={list.length <= 1}
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
 * Second box ("Kotak Kenangan"). Opening it reveals the gallery: real engine
 * media when a cycle is revealed (or admin preview), else the honest
 * placeholder.
 */
function MemoryBox({
  onReadLetter,
  onRestart,
  items,
  getMediaUrl,
}: {
  onReadLetter: () => void;
  onRestart: () => void;
  items: GalleryItem[];
  getMediaUrl: (id: string) => string;
}) {
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
      {/* Full-screen glitter while the memory box opens, matching the gift box
          and the letter envelope. */}
      <GlitterBurst active={opening} durationMs={reduce ? 400 : 1500} seed={0x4b454e41} count={120} />

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
            <Gallery items={items} getMediaUrl={getMediaUrl} />
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
  galleryItems = [],
  mediaSrc,
}: ExperienceSceneProps) {
  const reduce = useReducedMotion();

  // Public: the revealed-media route. Admin preview before the reveal: the
  // admin media route (session + role), which is not date-gated.
  const getMediaUrl = mediaSrc ?? galleryMediaUrl;

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
      <BirthdayAmbientEffects />

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
                kenBurns={frame.src ? !reduce : false}
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
              <MemoryBox
              onReadLetter={onPrev}
              onRestart={onRestart}
              items={galleryItems}
              getMediaUrl={getMediaUrl}
            />
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
      <div className="mt-10 flex w-full max-w-md items-center justify-between gap-2 sm:gap-4">
        <button
          type="button"
          onClick={onPrev}
          disabled={active === 0}
          aria-label="Previous scene"
          className="rounded-full border border-white/20 px-3 py-2.5 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35 sm:px-5 sm:text-xs sm:tracking-[0.2em]"
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
          className="rounded-full border border-white/20 px-3 py-2.5 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35 sm:px-5 sm:text-xs sm:tracking-[0.2em]"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
