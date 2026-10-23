import { birthdayYear } from "@/lib/birthday/theme-registry";

/**
 * Birthday-experience URL params → ONE pure preview decision (Tahap 4G.44).
 *
 * Getting these params wrong is silent: a preview link without `full=1` keeps the
 * bundled default letter and an EMPTY opening frame, and a wrong `age` reads a
 * different edition's draft. Both happened, so the whole decision lives in this
 * pure function and is unit-tested instead of being re-derived inline.
 *
 *  - `preview=1` → admin preview: load the edition's BROWSER DRAFT. Every admin
 *                  variant implies this, so the opening frame always shows the
 *                  thumbnail the admin chose in Pustaka Media.
 *  - `full=1`    → the same draft, explicitly, starting from the gift box.
 *  - `letter=1`  → open the (draft) letter straight away.
 *  - `gallery=1` → land on the memory box (Kotak Kenangan).
 *  - `age=N`     → which edition (1–17); anything else falls back to 1.
 *  - `edition=N` → PUBLIC replay of an archived edition (from the Memory
 *                  Archive). Reads that edition's SERVER letter + gallery;
 *                  never a browser draft, so it is not an admin preview.
 *
 * A PUBLIC visitor (no preview params) never loads a local draft: the page reads
 * the SERVER letter of the most recent revealed cycle instead.
 */

export const EXPERIENCE_MIN_AGE = 1;
export const EXPERIENCE_MAX_AGE = 17;

export interface ExperienceParams {
  /** Admin preview (`preview=1`): show the "Back to admin" link. */
  fromAdmin: boolean;
  /** Load the edition's browser draft (letter + opening thumbnail). */
  useDraft: boolean;
  /** Edition age (1–17) whose draft/letter is shown. */
  age: number;
  /** Jump straight to the letter scene. */
  openLetter: boolean;
  /** Jump straight to the memory-box scene. */
  openGallery: boolean;
  /**
   * PUBLIC replay of one archived edition (`edition=N`), e.g. opened from the
   * Memory Archive. It reads the SERVER letter + gallery of that edition, never
   * a browser draft, and is not an admin preview.
   */
  editionAge: number | null;
  /**
   * CALENDAR YEAR of that edition (e.g. age 1 → 2026). The API query parameter
   * is a full year, not an age; keeping the conversion here means no caller can
   * send `year=1` by mistake.
   */
  editionYear: number | null;
}

function readAge(raw: string | null): number | null {
  const value = Number(raw ?? "");
  return Number.isInteger(value) && value >= EXPERIENCE_MIN_AGE && value <= EXPERIENCE_MAX_AGE
    ? value
    : null;
}

export function resolveExperienceParams(search: string): ExperienceParams {
  const params = new URLSearchParams(search);
  const preview = params.get("preview") === "1";
  const full = params.get("full") === "1";
  const letter = params.get("letter") === "1";
  const editionAge = readAge(params.get("edition"));

  const age = readAge(params.get("age")) ?? editionAge ?? 1;

  return {
    fromAdmin: preview,
    useDraft: preview || full || letter,
    age,
    openLetter: letter,
    openGallery: params.get("gallery") === "1",
    editionAge,
    // The letter/gallery APIs take the CALENDAR year; age 1 is 2026.
    editionYear: editionAge === null ? null : birthdayYear(editionAge),
  };
}
