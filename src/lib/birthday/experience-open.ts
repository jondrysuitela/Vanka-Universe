import { isCycleRevealed } from "@/lib/birthday/cycle";
import {
  FIRST_THEME_AGE,
  birthdayYear,
  formatBirthdayDate,
} from "@/lib/birthday/theme-registry";

/**
 * When the PUBLIC Vanka Experience opens.
 *
 * The experience is the birthday gift itself, so nothing of it is shown before
 * its own birthday: the landing-page chapter and the `/birthday-experience`
 * route both stay closed until 27 October 2026 00:00 WIT (age 1's reveal
 * instant). Before then, a public visitor gets the date instead of the
 * experience.
 *
 * The reveal instant comes from the SAME cycle policy the server uses
 * (`isCycleRevealed`), so the gate here and the gate in
 * `/api/birthday/gallery` + `/api/birthday/letter` can never drift apart.
 *
 * PURE: no I/O, no clock reads. Callers pass `now` explicitly. Safe on the
 * client — importing this module pulls in no server-only code.
 */

/** Cycle year of the first (and currently built) experience: 2026. */
export const FIRST_EXPERIENCE_YEAR = birthdayYear(FIRST_THEME_AGE);

/** Human label of the opening date, e.g. "27 Oktober 2026". */
export const FIRST_EXPERIENCE_OPEN_LABEL = formatBirthdayDate(FIRST_THEME_AGE);

/** True once the first experience's birthday has arrived (00:00 WIT). */
export function isFirstExperienceOpen(now: Date): boolean {
  return isCycleRevealed(FIRST_EXPERIENCE_YEAR, now);
}

/** The one sentence shown wherever the experience is still closed. */
export function experienceLockedMessage(): string {
  return `Vanka Experience terbuka pada ${FIRST_EXPERIENCE_OPEN_LABEL}.`;
}
