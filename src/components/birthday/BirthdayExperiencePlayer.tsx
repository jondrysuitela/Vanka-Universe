"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import ExperienceMusic from "./ExperienceMusic";
import ExperienceScene, { LETTER_SCENE_INDEX, SCENE_COUNT } from "./ExperienceScene";
import GiftBoxIntro from "./GiftBoxIntro";
import {
  DEFAULT_LETTER_DRAFT,
  EMPTY_LETTER_DRAFT,
  loadLetterForAge,
  type LetterDraft,
} from "./LetterScene";
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
import { birthdayYear } from "@/lib/birthday/theme-registry";

/**
 * The birthday experience itself — one player, used in TWO places:
 *
 *  - `/birthday-experience` (full page), and
 *  - the landing-page OVERLAY on the birthday itself (see `BirthdayOverlay`).
 *
 * Keeping one component means the overlay can never drift from the page: both
 * read the same letter, the same gallery, and use the same byte route.
 *
 * CONTENT SOURCE — three modes, decided by the caller (all pure, unit-tested in
 * `experience-params.ts` / `experience-open.ts`):
 *
 *  1. ADMIN DRAFT (`draftPreview`): the browser-local draft of `draftAge`, so the
 *     editor sees exactly what they typed, including unsaved edits.
 *  2. PUBLIC REPLAY (`editionAge`): the SERVER letter + gallery of that archived
 *     edition (Memory Archive).
 *  3. PUBLIC DEFAULT (`editionAge === null`): the newest revealed edition.
 *
 * When the server letter cannot be read, the bundled default letter is shown —
 * the author's own text. It is never an empty screen and never invented filler.
 */

export interface BirthdayExperiencePlayerProps {
  /** Admin draft preview (`?preview=1` / `full=1` / `letter=1`). */
  draftPreview: boolean;
  /** Edition age of that draft (1–17). */
  draftAge: number;
  /** Land directly on the letter scene (admin `letter=1`). */
  openLetter?: boolean;
  /** Countdown flow: begin the background music at the birthday celebration. */
  autoStartMusic?: boolean;
  /** Admin countdown flow: treat the celebration's continue click as opening the gift. */
  autoOpenGift?: boolean;
  /** PUBLIC replay of one archived edition; null = the newest revealed one. */
  editionAge: number | null;
  /**
   * CALENDAR YEAR of that edition (age 1 → 2026). The letter/gallery APIs are
   * queried by year, never by age.
   */
  editionYear?: number | null;
  /** Full-screen overlay mode: adds a close control and fills the viewport. */
  overlay?: boolean;
  /** Required in overlay mode — returns the visitor to the landing page. */
  onClose?: () => void;
}

export default function BirthdayExperiencePlayer({
  draftPreview,
  draftAge,
  openLetter = false,
  autoStartMusic = false,
  autoOpenGift = false,
  editionAge,
  editionYear = null,
  overlay = false,
  onClose,
}: BirthdayExperiencePlayerProps) {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [autoOpenConsumed, setAutoOpenConsumed] = useState(false);
  /**
   * The visitor has clicked the gift box. That click is the gesture browsers
   * require before audio may play, so music is keyed off THIS — not off the
   * scene, which also changes on an admin jump straight to the letter.
   */
  const [musicStarted, setMusicStarted] = useState(false);
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
    let active = true;

    if (!draftPreview) {
      // Public: the revealed letter + gallery of ONE edition from the server.
      // Nothing here touches `localStorage`, so it may start immediately.
      void (async () => {
        try {
          // The APIs are queried by CALENDAR YEAR (2026), not by age (1).
          const experience = await loadPublicExperience(
            (input, init) => fetch(input, init),
            editionYear === null ? {} : { year: editionYear },
          );
          if (!active) return;
          if (experience.letterDraft) setLetterDraft(experience.letterDraft);
          setGalleryItems(experience.galleryItems);
        } catch {
          // The loader never throws; this is a belt-and-braces guard. The bundled
          // default letter and the honest placeholder stay in place.
        }
        if (active) setReady(true);
      })();

      return () => {
        active = false;
      };
    }

    // Admin preview: the draft lives in `localStorage`, which only exists in the
    // browser, so the read happens one frame in. Until then the bundled default
    // letter is shown, which is also what SSR renders.
    const frame = requestAnimationFrame(() => {
      if (!active) return;

      const stored = loadLetterForAge(draftAge);
      setLetterDraft(stored ?? EMPTY_LETTER_DRAFT);
      setLetterPreview(true);
      // The preview bypasses the date gate, but it still needs the ADMIN media
      // route: the public one only serves already-revealed media.
      setMediaRoute(resolveMediaRoute(true));

      if (openLetter) {
        setRevealed(true);
        setActive(LETTER_SCENE_INDEX);
      }
      setReady(true);

      void (async () => {
        try {
          const gallery = await loadBirthdayGallery((input, init) => fetch(input, init), true);
          if (active && gallery.status === "ok") setGalleryItems(gallery.data.items);
        } catch {
          // The loader never throws; the gallery keeps its honest placeholder.
        }
      })();
    });

    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [draftPreview, draftAge, openLetter, editionAge, editionYear]);

  const next = useCallback(() => {
    setActive((current) => Math.min(current + 1, SCENE_COUNT - 1));
  }, []);

  const prev = useCallback(() => {
    setActive((current) => Math.max(current - 1, 0));
  }, []);

  const restart = useCallback(() => {
    setRevealed(false);
    setActive(0);
    setMusicStarted(false);
    setAutoOpenConsumed(true);
  }, []);
  const experienceStarted = revealed || (autoOpenGift && !autoOpenConsumed);
  const playbackStarted = musicStarted || autoStartMusic || (autoOpenGift && !autoOpenConsumed);

  return (
    <div className={overlay ? "relative min-h-dvh w-full" : "relative min-h-dvh"}>
      {overlay && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-5 z-40 rounded-full border border-[#e9c67c]/40 bg-[#0b1226]/80 px-4 py-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#f6e3b2] backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          Tutup ✕
        </button>
      )}

      {/*
        Background music for this edition. It is mounted from the start (so the
        file probe can run) but stays silent until the gift box is opened.
      */}
      {ready && (
        <ExperienceMusic
          age={editionAge ?? draftAge}
          editionYear={editionYear ?? birthdayYear(editionAge ?? draftAge)}
          started={playbackStarted}
          adminPreview={draftPreview}
          overlay={overlay}
        />
      )}

      {!overlay && draftPreview && (
        <Link
          href="/admin/birthday"
          className="absolute left-4 top-5 z-30 rounded-full border border-[#e9c67c]/40 bg-[#0b1226]/80 px-4 py-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#f6e3b2] backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          ← Back to admin
        </Link>
      )}

      {ready &&
        (experienceStarted ? (
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
          <GiftBoxIntro onOpen={() => setRevealed(true)} onReveal={() => setMusicStarted(true)} />
        ))}
    </div>
  );
}
