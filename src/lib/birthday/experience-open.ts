import { cycleForDate, isCycleRevealed, type BirthdayCycle } from "@/lib/birthday/cycle";
import {
  FIRST_THEME_AGE,
  birthdayYear,
  formatBirthdayDate,
} from "@/lib/birthday/theme-registry";

/**
 * When the PUBLIC Vanka Experience opens, and how it appears.
 *
 * Three phases, all derived from the SAME cycle policy the server uses, so the
 * UI and the API gates can never drift apart:
 *
 *  - `before`   — nothing is public yet. The experience is not shown anywhere.
 *  - `birthday` — the birthday ITSELF (27 October, 00:00 → 28 October 00:00 WIT).
 *                 The experience takes over the landing page as a full-screen
 *                 overlay, and can be re-opened from the chapter card.
 *  - `archive`  — from the next day on. The overlay is gone; the experience
 *                 lives in the Memory Archive and can be replayed by the public.
 *
 * The birthday day is the one-day overlap described in `cycle.ts`: the cycle is
 * already revealed AND still accepting uploads, so `revealAt <= now < uploadEnd`.
 *
 * PURE: no I/O, no clock reads. Callers pass `now` explicitly. Safe on the
 * client — importing this module pulls in no server-only code.
 */

/** Cycle year of the first (and currently built) experience: 2026. */
export const FIRST_EXPERIENCE_YEAR = birthdayYear(FIRST_THEME_AGE);

/** Human label of the opening date, e.g. "27 Oktober 2026". */
export const FIRST_EXPERIENCE_OPEN_LABEL = formatBirthdayDate(FIRST_THEME_AGE);

export type PublicExperiencePhase = "before" | "birthday" | "archive";

/** True once the first experience's birthday has arrived (00:00 WIT). */
export function isFirstExperienceOpen(now: Date): boolean {
  return isCycleRevealed(FIRST_EXPERIENCE_YEAR, now);
}

/**
 * The cycle whose BIRTHDAY DAY contains `now`, or `null`.
 *
 * That is the window `revealAt <= now < uploadEnd` — the single day on which a
 * cycle is public AND still collecting the day's own photos. It is deliberately
 * not `cycleForDate` alone: that window starts a year earlier.
 */
export function birthdayDayCycle(now: Date): BirthdayCycle | null {
  const cycle = cycleForDate(now);
  if (!cycle) return null;
  const time = now.getTime();
  if (time < cycle.revealAt.getTime()) return null;
  if (time >= cycle.uploadEnd.getTime()) return null;
  return cycle;
}

/** Which public phase `now` is in. */
export function publicExperiencePhase(now: Date): PublicExperiencePhase {
  if (!isFirstExperienceOpen(now)) return "before";
  return birthdayDayCycle(now) ? "birthday" : "archive";
}

/** The one sentence shown wherever the experience is still closed. */
export function experienceLockedMessage(): string {
  return `Vanka Experience terbuka pada ${FIRST_EXPERIENCE_OPEN_LABEL}.`;
}
