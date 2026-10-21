import type { LetterDraft, LetterSection, LetterThumbnail } from "@/components/birthday/LetterScene";
import { loadBirthdayGallery, type GalleryItem } from "@/lib/birthday/gallery/client-sync";
import { loadBirthdayLetter, type PublicLetter } from "@/lib/birthday/letters/public-sync";

/**
 * Public birthday-experience loader (Tahap 4G.43 wiring).
 *
 * PURE decision layer: it performs NO rendering and NO storage. It combines the
 * two PUBLIC endpoints into one view model:
 *   - GET /api/birthday/letter  → the saved letter (date-gated)
 *   - GET /api/birthday/gallery → the cycle's media (date-gated)
 *
 * HONESTY RULES (inherited from both sync modules, restated here because this
 * is the module the page actually calls):
 *  - A server error is NEVER turned into "no letter" / "no photos". It becomes
 *    `unavailable`, and the caller keeps the bundled default letter so the
 *    experience still reads as a letter instead of an empty box.
 *  - A `locked` gate (the birthday has not happened yet) is reported as such,
 *    so the page can say so plainly.
 *  - Nothing is ever fabricated: an unshaped payload is `unavailable`.
 *
 * FALLBACK LETTER: the bundled default is the author's own text, shipped with
 * the app — a real, intended letter, not invented filler. It is used whenever
 * the server has no saved letter or cannot be reached. This does NOT expose
 * anything new: the saved letter is served by the API only from the reveal
 * instant onwards, and a letter that was edited but not yet revealed is
 * intentionally frozen (the API refuses such writes with `LETTER_PUBLISHED`).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PublicExperience {
  /** The letter to read: the server's saved letter, or the bundled default. */
  letterDraft: LetterDraft | null;
  /** True when the letter came from the server (not the bundled default). */
  letterFromServer: boolean;
  /** True when the server's letter could not be read at all. */
  letterUnavailable: boolean;
  /** True when the server gate is still closed (the birthday has not come). */
  letterLocked: boolean;
  /** Opening frame settings (from the server letter, else the page default). */
  thumbnail: LetterThumbnail | null;
  /** Gallery media for the memory box (empty when nothing is revealed yet). */
  galleryItems: GalleryItem[];
  /** True when the gallery could not be read. */
  galleryUnavailable: boolean;
  /** True when the gallery gate is still closed. */
  galleryLocked: boolean;
}

/** Convert the public letter payload into the reader's draft shape. */
export function toLetterDraft(letter: PublicLetter): LetterDraft {
  // A malformed section is DROPPED, never rendered as-is: the reader must not
  // crash on a half-shaped payload, and it must not invent a section either.
  const sections: LetterSection[] = [];
  letter.sections.forEach((section, index) => {
    if (!section || typeof section !== "object") return;
    if (typeof section.heading !== "string" || typeof section.body !== "string") return;
    sections.push({
      id: typeof section.id === "string" && section.id ? section.id : `s${index + 1}`,
      heading: section.heading,
      body: section.body,
    });
  });

  return {
    title: letter.title,
    date: letter.displayDate,
    fullText: letter.fullText,
    sections,
    thumbnail: letter.thumbnail ?? undefined,
  };
}

/**
 * Load the public experience.
 *
 * Both requests run in parallel and BOTH are attempted: one failing must not
 * hide the other (a broken gallery endpoint still leaves a readable letter).
 *
 * `letterDraft` is null when no letter could be obtained from the server AND
 * the caller has no bundled default to fall back to — the caller decides.
 */
export async function loadPublicExperience(
  fetcher: FetchLike,
  options: { year?: number } = {},
): Promise<PublicExperience> {
  const [letterResult, galleryResult] = await Promise.all([
    loadBirthdayLetter(fetcher, options.year),
    loadBirthdayGallery(fetcher, false),
  ]);

  // --- letter -------------------------------------------------------------
  let letterDraft: LetterDraft | null = null;
  let letterFromServer = false;
  let letterUnavailable = false;
  let letterLocked = false;

  if (letterResult.status === "ok") {
    if (letterResult.data.letter) {
      letterDraft = toLetterDraft(letterResult.data.letter);
      letterFromServer = true;
    } else {
      // The edition exists but nothing was saved yet: honest empty state.
      letterUnavailable = true;
    }
  } else if (letterResult.status === "locked") {
    letterLocked = true;
  } else {
    letterUnavailable = true;
  }

  // --- gallery ------------------------------------------------------------
  let galleryItems: GalleryItem[] = [];
  let galleryUnavailable = false;
  let galleryLocked = false;

  if (galleryResult.status === "ok") {
    galleryItems = galleryResult.data.items;
  } else if (galleryResult.status === "locked") {
    galleryLocked = true;
  } else {
    galleryUnavailable = true;
  }

  return {
    letterDraft,
    letterFromServer,
    letterUnavailable,
    letterLocked,
    thumbnail: letterDraft?.thumbnail ?? null,
    galleryItems,
    galleryUnavailable,
    galleryLocked,
  };
}
