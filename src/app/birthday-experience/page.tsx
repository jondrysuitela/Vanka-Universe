"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ExperienceScene, {
  LETTER_SCENE_INDEX,
  SCENE_COUNT,
} from "@/components/birthday/ExperienceScene";
import GiftBoxIntro from "@/components/birthday/GiftBoxIntro";
import {
  DEFAULT_LETTER_DRAFT,
  EMPTY_LETTER_DRAFT,
  loadLetterForAge,
  type LetterDraft,
} from "@/components/birthday/LetterScene";
import { resolveExperienceParams } from "@/lib/birthday/experience-params";
import {
  FIRST_EXPERIENCE_OPEN_LABEL,
  experienceLockedMessage,
  isFirstExperienceOpen,
} from "@/lib/birthday/experience-open";
import {
  mediaUrlFor,
  resolveMediaRoute,
  type ExperienceMediaRoute,
} from "@/lib/birthday/experience-media";
import {
  loadBirthdayGallery,
  type GalleryItem,
} from "@/lib/birthday/gallery/client-sync";
import { loadPublicExperience } from "@/lib/birthday/public-experience";

/**
 * Public birthday experience.
 *
 * CONTENT SOURCE — two modes, never mixed up. The decision is made by ONE
 * pure, unit-tested function (`resolveExperienceParams`), not re-derived here:
 *
 *  1. DRAFT (admin): `preview=1` / `full=1` / `letter=1` — reads the
 *     BROWSER-LOCAL draft (`localStorage`) so the editor sees exactly what it
 *     typed, including edits that were never saved to the server. The server's
 *     published letter is deliberately NOT used here: an admin must see their
 *     own unsaved edits.
 *
 *  2. SERVER (public visitor): no draft flags — reads the PUBLIC, date-gated
 *     API (`GET /api/birthday/letter` and `GET /api/birthday/gallery`). These
 *     only answer from the reveal instant (the birthday itself) onwards, so
 *     nothing leaks early.
 *
 *     When the server letter cannot be read (the gate is still closed, or the
 *     server is unreachable) the bundled default letter is shown instead — the
 *     author's own text, shipped with the app. It is never an empty screen and
 *     never invented filler.
 */
export default function BirthdayExperiencePage() {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);
  const [fromAdmin, setFromAdmin] = useState(false);
  /**
   * Public gate: the experience is not shown before its birthday. `null` until
   * the browser clock has been read (SSR has no visitor clock), so nothing is
   * revealed during hydration and no markup mismatches.
   */
  const [experienceOpen, setExperienceOpen] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [letterDraft, setLetterDraft] = useState<LetterDraft>(DEFAULT_LETTER_DRAFT);
  const [letterPreview, setLetterPreview] = useState(false);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  /**
   * Which byte route the gallery must use.
   *
   * Public: the date-gated public route (only revealed media).
   * Admin preview: the private admin route, which needs the session cookie and
   * is NOT date-gated — the admin must see the media before the birthday.
   *
   * The route is a plain STRING in state, never the builder itself: a function
   * held in state is easy to set with the updater form by mistake
   * (`setMediaSrc((id) => ...)`), which would store the builder's RETURN value
   * instead of the builder. The decision itself lives in the pure, unit-tested
   * `resolveMediaRoute` / `mediaUrlFor`.
   */
  const [mediaRoute, setMediaRoute] = useState<ExperienceMediaRoute>("public");
  const mediaSrc = useMemo(
    () => (id: string) => mediaUrlFor(mediaRoute, id),
    [mediaRoute],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const plan = resolveExperienceParams(window.location.search);
      setFromAdmin(plan.fromAdmin);

      // The admin preview (?preview=1 / full=1 / letter=1) is never gated: the
      // author must see the experience before the birthday. A public visitor is.
      const open = plan.fromAdmin || isFirstExperienceOpen(new Date());
      setExperienceOpen(open);
      if (!open) {
        // Closed branch only — nothing of the experience is loaded or fetched.
        setReady(true);
        return;
      }

      if (plan.useDraft) {
        // Admin preview: read the browser-local draft of the chosen edition.
        const stored = loadLetterForAge(plan.age);
        setLetterDraft(stored ?? EMPTY_LETTER_DRAFT);
        setLetterPreview(true);
        // The preview bypasses the date gate, but it still needs the ADMIN
        // media route: the public one only serves already-revealed media.
        setMediaRoute(resolveMediaRoute(true));

        void (async () => {
          try {
            const gallery = await loadBirthdayGallery(
              (input, init) => fetch(input, init),
              true,
            );
            if (gallery.status === "ok") setGalleryItems(gallery.data.items);
          } catch {
            // The loader never throws; the gallery keeps its honest placeholder.
          }
        })();

        if (plan.openLetter) {
          setRevealed(true);
          setActive(LETTER_SCENE_INDEX);
        }
        setReady(true);
        return;
      }

      // Public: load the revealed letter + gallery from the server.
      void (async () => {
        try {
          const experience = await loadPublicExperience((input, init) => fetch(input, init));
          if (experience.letterDraft) {
            setLetterDraft(experience.letterDraft);
          }
          setGalleryItems(experience.galleryItems);
        } catch {
          // The loader never throws; this is a belt-and-braces guard. The
          // bundled default letter and the honest placeholder stay in place.
        }
        setReady(true);
      })();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const next = useCallback(() => {
    setActive((current) => Math.min(current + 1, SCENE_COUNT - 1));
  }, []);

  const prev = useCallback(() => {
    setActive((current) => Math.max(current - 1, 0));
  }, []);

  const restart = useCallback(() => setActive(0), []);

  return (
    <main className="relative min-h-dvh">
      {/* shared night-sky backdrop */}
      <div aria-hidden="true" className="cosmos-sky absolute inset-0" />
      <div aria-hidden="true" className="cosmos-aurora-a absolute -top-32 left-[8%] h-[55vmin] w-[55vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-b absolute right-[4%] top-[30%] h-[45vmin] w-[45vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-c absolute bottom-[-10%] left-[30%] h-[60vmin] w-[60vmin]" />
      <div aria-hidden="true" className="cosmos-vignette absolute inset-0" />

      {fromAdmin && (
        <Link
          href="/admin/birthday"
          className="absolute left-4 top-5 z-30 rounded-full border border-[#e9c67c]/40 bg-[#0b1226]/80 px-4 py-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#f6e3b2] backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          ← Back to admin
        </Link>
      )}

      {ready &&
        experienceOpen === true &&
        (revealed ? (
          <ExperienceScene
            active={active}
            onNext={next}
            onPrev={prev}
            onRestart={restart}
            letterDraft={letterDraft}
            letterPreview={letterPreview}
            thumbnail={letterDraft.thumbnail}
            galleryItems={galleryItems}
            mediaSrc={mediaSrc}
          />
        ) : (
          <GiftBoxIntro onOpen={() => setRevealed(true)} />
        ))}

      {/*
        Closed for the public until the reveal instant. The admin preview never
        reaches this branch (it sets `experienceOpen` to true). Nothing of the
        experience — letter, thumbnail, gallery — is rendered here.
      */}
      {ready && experienceOpen === false && (
        <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
          <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-5 py-2 font-sans text-[0.65rem] font-medium uppercase tracking-[0.4em] text-[#f6e3b2] backdrop-blur-md">
            Masih Dijaga
          </span>
          <h1 className="text-shadow-lg font-display text-3xl leading-snug text-[#f6e3b2] sm:text-4xl">
            {FIRST_EXPERIENCE_OPEN_LABEL}
          </h1>
          <p role="status" className="font-serif text-lg leading-relaxed text-white/75">
            {experienceLockedMessage()}
          </p>
          <p className="font-serif text-base italic text-white/60">
            Sampai tanggal itu, cerita ini hanya untuk Ayah dan Ibu.
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-white/80 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
          >
            ← Kembali ke Vanka Universe
          </Link>
        </div>
      )}
    </main>
  );
}
