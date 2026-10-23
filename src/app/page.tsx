"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import CosmicBackdrop from "@/components/CosmicBackdrop";
import BirthdayOverlay from "@/components/birthday/BirthdayOverlay";
import {
  FIRST_EXPERIENCE_OPEN_LABEL,
  birthdayDayCycle,
  publicExperiencePhase,
  type PublicExperiencePhase,
} from "@/lib/birthday/experience-open";
import type { BirthdayCycle } from "@/lib/birthday/cycle";

type Chapter = {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  /** Private archive chapter: adds the lock glyph and a "Dilindungi PIN" badge. */
  locked: boolean;
  /**
   * The Vanka Experience chapter is CLOSED until its reveal date: before then
   * the card does not navigate, it only says when the experience opens.
   */
  gated: boolean;
  /**
   * Per-card glow. A thin coloured shadow at rest that intensifies on
   * hover/focus. Pure box-shadow — no extra elements, no layout impact.
   */
  glow: string;
};

/**
 * Lock glyph drawn in the same cosmic-gold language as the rest of the page.
 * Decorative only (`aria-hidden`); it explains that the archive is protected,
 * it is NOT a session/PIN state.
 */
function LockGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

const CHAPTERS: readonly Chapter[] = [
  {
    eyebrow: "Chapter One · 27 October 2026",
    title: "Birthday Experience",
    body: "A cinematic birthday journey made for your very first year — still being written, scene by scene. This chapter opens on Vanka's first birthday.",
    cta: "Open the Birthday Experience",
    href: "/birthday-experience",
    locked: false,
    gated: true,
    glow: "shadow-[0_0_26px_-14px_rgba(139,92,246,0.6)] hover:shadow-[0_0_48px_-10px_rgba(139,92,246,0.75)] focus-visible:shadow-[0_0_48px_-10px_rgba(139,92,246,0.75)]",
  },
  {
    eyebrow: "Chapter Two · A chapter for every year",
    title: "Memory Archive",
    body: "Every birthday Vanka has had, kept year by year — each one replayable in its own theme once its own birthday has passed. The first chapter opens on 27 October 2026.",
    cta: "Visit the Memory Archive",
    href: "/memory-archive",
    locked: false,
    gated: false,
    glow: "shadow-[0_0_26px_-14px_rgba(96,165,250,0.6)] hover:shadow-[0_0_48px_-10px_rgba(96,165,250,0.75)] focus-visible:shadow-[0_0_48px_-10px_rgba(96,165,250,0.75)]",
  },
  {
    eyebrow: "Chapter Three · Family only",
    title: "Arsip Privat",
    body: "A private room of memories, protected by a PIN and opened only by family. The contents stay behind the lock — this dashboard never reads them.",
    cta: "Buka Arsip Privat",
    href: "/arsip-ibu",
    locked: true,
    gated: false,
    glow: "shadow-[0_0_26px_-14px_rgba(233,198,124,0.65)] hover:shadow-[0_0_48px_-10px_rgba(233,198,124,0.8)] focus-visible:shadow-[0_0_48px_-10px_rgba(233,198,124,0.8)]",
  },
];

/** Copy shown on the closed experience card / announcement. */
const GATED_BADGE = `Terbuka ${FIRST_EXPERIENCE_OPEN_LABEL}`;
const GATED_NOTICE = `Vanka Experience akan terbuka pada ${FIRST_EXPERIENCE_OPEN_LABEL}. Sampai saat itu, ceritanya masih dijaga.`;
/** Badge on the card on the birthday itself, when the overlay can be re-opened. */
const OPEN_BADGE = "Hari ini · Ulang tahun Vanka";

export default function Home() {
  const reducedMotion = useReducedMotion();
  /**
   * Which public phase the visitor is in — `null` until the browser clock has
   * been read in an effect (the server has no visitor clock, so checking the
   * date during SSR would mismatch on hydration). Until then the closed card is
   * shown, which is also the correct state for every visitor before 27 October.
   */
  const [phase, setPhase] = useState<PublicExperiencePhase | null>(null);
  /**
   * The cycle being celebrated TODAY (only on the birthday itself), and whether
   * its overlay is currently open. Keeping them apart is what lets a visitor
   * close the overlay and re-open it from the chapter card later that day.
   */
  const [todayCycle, setTodayCycle] = useState<BirthdayCycle | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [showGateNotice, setShowGateNotice] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const now = new Date();
      setPhase(publicExperiencePhase(now));
      // On the birthday itself the overlay is what a visitor meets first.
      const celebrating = birthdayDayCycle(now);
      setTodayCycle(celebrating);
      setOverlayOpen(celebrating !== null);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Close the announcement with Escape, like any other dialog.
  useEffect(() => {
    if (!showGateNotice) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowGateNotice(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showGateNotice]);

  const scrollToSection = (id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  const reveal = {
    initial: reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 32 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.15 },
  };

  return (
    <main className="relative min-h-dvh">
      <CosmicBackdrop />

      {/* ---------------------------------------------- hero */}
      <section
        id="top"
        className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-28 text-center sm:px-10"
      >
        <div
          aria-hidden="true"
          className="gradient-aurora pointer-events-none absolute inset-0 opacity-60"
        />

        <motion.div
          className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-8"
          initial={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.1 }}
        >
          <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-5 py-2 font-sans text-[0.68rem] font-medium uppercase tracking-[0.4em] text-[#f6e3b2] backdrop-blur-md">
            First Orbit · Live
          </span>

          <h1 className="gold-glow bg-gradient-to-b from-[#fdf3d8] via-[#eecb8b] to-[#c99b53] bg-clip-text font-display text-5xl leading-[1.05] text-transparent sm:text-7xl lg:text-8xl">
            Vanka Universe
          </h1>

          <p className="font-serif text-xl italic text-white/85 sm:text-2xl lg:text-3xl">
            A Universe of Memories. A Lifetime of Love.
          </p>

          <p className="text-shadow font-script text-2xl text-[#f0d9a4] sm:text-3xl lg:text-4xl">
            {"For every chapter of your life, my love will always be here."}
          </p>

          <div className="mt-4 flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => scrollToSection("story")}
              className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98] sm:w-auto"
            >
              {"Enter Vanka's Universe"}
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("chapters")}
              className="inline-flex w-full items-center justify-center gap-3 rounded-full border border-white/25 px-8 py-4 font-sans text-xs font-semibold uppercase tracking-[0.28em] text-white/80 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] sm:w-auto"
            >
              Meet the Chapters
            </button>
          </div>
        </motion.div>

        <div
          aria-hidden="true"
          className="absolute bottom-8 left-1/2 h-14 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#e9c67c]/70 to-transparent"
        />
      </section>

      {/* ---------------------------------------------- story */}
      <section id="story" className="relative px-6 py-24 sm:px-10 sm:py-32">
        <motion.div
          className="mx-auto grid max-w-6xl items-start gap-12 lg:grid-cols-[1.5fr_1fr] lg:gap-16"
          initial={reveal.initial}
          whileInView={reveal.whileInView}
          viewport={reveal.viewport}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="flex flex-col gap-6">
            <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
              The Beginning
            </p>
            <h2 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-4xl lg:text-5xl">
              Every love story begins with a first light
            </h2>
            <p className="font-serif text-lg leading-relaxed text-white/75 sm:text-xl">
              Vanka Universe was built as a quiet place to keep what usually
              slips away — the laughter, the ordinary days, the tiny milestones
              that slowly rewrite a heart. Nothing here stays ordinary once you
              name it a memory.
            </p>
            <p className="font-serif text-lg leading-relaxed text-white/75 sm:text-xl">
              Each moment becomes a star. Some shine bright and new; others
              glow softly with the warmth of days already lived. Together they
              form a sky that belongs only to us — a sky we are only beginning
              to map.
            </p>
            <p className="font-serif text-lg leading-relaxed text-white/75 sm:text-xl">
              On 27 October 2026 the first candle will be lit: your very first
              birthday. Until then this universe keeps growing, chapter by
              chapter, so that one day you can walk through it and feel how
              loved you already were.
            </p>
          </div>

          <aside className="backdrop-blur-glass rounded-3xl p-8 sm:p-10">
            <p className="text-shadow font-script text-3xl leading-snug text-[#f0d9a4]">
              {"“For every chapter of your life, my love will always be here.”"}
            </p>
            <div className="cosmos-divider my-7 h-px w-full" />
            <p className="font-sans text-[0.7rem] uppercase tracking-[0.4em] text-white/55">
              First Birthday
            </p>
            <p className="mt-2 font-display text-3xl text-[#f6e3b2] sm:text-4xl">
              27 October 2026
            </p>
            <p className="mt-4 font-sans text-sm leading-relaxed text-white/65">
              The date this universe lights its first star. The celebration
              chapter is being written right now.
            </p>
          </aside>
        </motion.div>
      </section>

      {/* ---------------------------------------------- chapters */}
      <section id="chapters" className="relative px-6 py-24 sm:px-10 sm:py-32">
        <motion.div
          className="mx-auto max-w-6xl"
          initial={reveal.initial}
          whileInView={reveal.whileInView}
          viewport={reveal.viewport}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
            <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
              Chapters
            </p>
            <h2 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-4xl lg:text-5xl">
              Three chapters, one universe
            </h2>
            <p className="font-serif text-lg leading-relaxed text-white/70">
              One chapter opens the celebration, one keeps our memories safe, and
              one stays locked for family alone. Each is honest about exactly where
              it stands today.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {CHAPTERS.map((chapter) => {
              // The Vanka Experience card has three states:
              //  - closed     → before the birthday: a button that only says when
              //                 it opens (also what SSR/first paint shows).
              //  - openable   → on the birthday itself: clicking re-opens the
              //                 same overlay in place.
              //  - plain link → from the next day on (and every other chapter).
              const closed = chapter.gated && (phase === null || phase === "before");
              const openable = chapter.gated && phase === "birthday";
              const cardClass = `group backdrop-blur-glass flex h-full flex-col gap-5 rounded-3xl p-8 text-left transition duration-300 motion-reduce:transition-none hover:-translate-y-1.5 hover:border-[#e9c67c]/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] sm:p-10 ${chapter.glow}`;

              const content = (
                <>
                  <span className="font-sans text-[0.65rem] uppercase tracking-[0.35em] text-[#e9c67c]">
                    {chapter.eyebrow}
                  </span>
                  <div className="flex items-center gap-3">
                    {(chapter.locked || closed) && (
                      <LockGlyph className="h-6 w-6 shrink-0 text-[#e9c67c]" />
                    )}
                    <h3 className="font-display text-2xl text-[#f6e3b2] sm:text-3xl">
                      {chapter.title}
                    </h3>
                  </div>
                  <p className="font-serif leading-relaxed text-white/75">
                    {chapter.body}
                  </p>
                  {chapter.locked && (
                    <span className="inline-flex w-fit items-center rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-3 py-1 font-sans text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-[#f6e3b2]">
                      Dilindungi PIN
                    </span>
                  )}
                  {closed && (
                    <span className="inline-flex w-fit items-center rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-3 py-1 font-sans text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-[#f6e3b2]">
                      {GATED_BADGE}
                    </span>
                  )}
                  {openable && (
                    <span className="inline-flex w-fit items-center rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-3 py-1 font-sans text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-[#f6e3b2]">
                      {OPEN_BADGE}
                    </span>
                  )}
                  <span className="mt-auto flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-[0.22em] text-white/85 transition group-hover:text-[#f6e3b2]">
                    {closed
                      ? "Lihat tanggal terbuka"
                      : openable
                        ? "Putar Vanka Experience"
                        : chapter.cta}
                    <span
                      aria-hidden="true"
                      className="transition duration-300 group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </span>
                </>
              );

              if (closed) {
                return (
                  <button
                    key={chapter.href}
                    type="button"
                    onClick={() => setShowGateNotice(true)}
                    aria-haspopup="dialog"
                    className={cardClass}
                  >
                    {content}
                  </button>
                );
              }

              if (openable) {
                return (
                  <button
                    key={chapter.href}
                    type="button"
                    onClick={() => setOverlayOpen(true)}
                    aria-haspopup="dialog"
                    className={cardClass}
                  >
                    {content}
                  </button>
                );
              }

              return (
                <Link key={chapter.href} href={chapter.href} className={cardClass}>
                  {content}
                </Link>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* ---------------------------------------------- closing */}
      <section
        id="closing"
        className="relative px-6 pb-28 pt-24 text-center sm:px-10"
      >
        <motion.div
          className="mx-auto flex max-w-3xl flex-col items-center gap-7"
          initial={reveal.initial}
          whileInView={reveal.whileInView}
          viewport={reveal.viewport}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div aria-hidden="true" className="cosmos-divider h-px w-40" />

          <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
            Until the Next Chapter
          </p>

          <h2 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-4xl lg:text-5xl">
            {"Here's to your first year among the stars"}
          </h2>

          <p className="font-serif text-xl italic text-white/80 sm:text-2xl">
            A Universe of Memories. A Lifetime of Love.
          </p>

          <p className="text-shadow font-script text-2xl text-[#f0d9a4] sm:text-3xl">
            {"For every chapter of your life, my love will always be here."}
          </p>

          <p className="font-display text-lg text-white/70 sm:text-xl">
            27 October 2026
          </p>

          <button
            type="button"
            onClick={() => scrollToSection("top")}
            className="mt-2 inline-flex items-center justify-center gap-3 rounded-full border border-white/25 px-8 py-4 font-sans text-xs font-semibold uppercase tracking-[0.28em] text-white/80 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
          >
            <span aria-hidden="true">↑</span>
            Return to the Stars
          </button>

          <p className="mt-6 font-sans text-[0.65rem] uppercase tracking-[0.35em] text-white/40">
            Vanka Universe · Phase One
          </p>
        </motion.div>
      </section>

      {/*
        Announcement for a closed chapter. It replaces navigation entirely: a
        public visitor cannot open the experience before its reveal date, and
        this is where they learn when it opens.
      */}
      {showGateNotice && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowGateNotice(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gate-title"
            aria-describedby="gate-desc"
            className="backdrop-blur-glass relative w-full max-w-md rounded-3xl border border-[#e9c67c]/30 p-8 text-center"
          >
            <p className="font-sans text-[0.65rem] font-semibold uppercase tracking-[0.4em] text-[#e9c67c]">
              Chapter One
            </p>
            <h2
              id="gate-title"
              className="text-shadow-lg mt-3 font-display text-2xl text-[#f6e3b2] sm:text-3xl"
            >
              {FIRST_EXPERIENCE_OPEN_LABEL}
            </h2>
            <p id="gate-desc" className="mt-4 font-serif leading-relaxed text-white/75">
              {GATED_NOTICE}
            </p>
            <button
              type="button"
              onClick={() => setShowGateNotice(false)}
              className="mt-7 inline-flex items-center justify-center rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-8 py-3.5 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2]"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}

      {/*
        On the birthday ITSELF the experience covers the landing page. It is the
        same player as the Memory Archive replay, only rendered full-screen over
        the dashboard. Closing it reveals the dashboard; the chapter card can
        re-open it for the rest of the day.
      */}
      {todayCycle !== null && overlayOpen && (
        <BirthdayOverlay
          editionAge={todayCycle.age}
          editionYear={todayCycle.year}
          onClose={() => setOverlayOpen(false)}
        />
      )}
    </main>
  );
}
