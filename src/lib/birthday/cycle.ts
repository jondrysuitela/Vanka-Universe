import {
  BIRTH_DATE,
  THEME_MAX_AGE,
  THEME_MIN_AGE,
} from "@/lib/birthday/theme-registry";

/**
 * Birthday cycle policy (public-reveal window and upload window).
 *
 * Vanka's birthday is 27 October. Every uploaded photo/video belongs to the
 * birthday cycle it was uploaded in. Two DIFFERENT instants matter, and they are
 * deliberately NOT the same:
 *
 *  1. REVEAL (`revealAt`) — 00:00 on the birthday. From this instant the cycle
 *     is public and the experience can be opened.
 *  2. UPLOAD WINDOW END (`uploadEnd`) — 00:00 the NEXT day, i.e. 28 October.
 *
 * WHY THEY DIFFER: photos and videos of the birthday itself are taken ON
 * 27 October. If the upload window closed at the reveal instant, a photo taken
 * at the party on 27 October would fall into NEXT YEAR's album. Closing it a day
 * later keeps the whole birthday — including the day of the celebration — in
 * that year's album, so the album fills up with that day's photos too.
 *
 * Consequence: a cycle's upload window and its reveal overlap for exactly one
 * day. On 27 October the cycle is already public AND still collecting uploads.
 * Consecutive upload windows still neither overlap nor leave a gap, because
 * cycle N+1 starts exactly where cycle N ends (28 Oct 00:00).
 *
 * Time anchor: 27 October 00:00 at UTC+09:00 (Indonesia Timur / WIT). Boundaries
 * are therefore fixed UTC instants, so the rule is deterministic and testable —
 * no local-machine timezone is ever consulted.
 *
 * PURE: no I/O, no clock reads. Callers pass `now` explicitly.
 */

/** Fixed birthday timezone offset: UTC+09:00 (Indonesia Timur). */
export const BIRTHDAY_UTC_OFFSET_MINUTES = 9 * 60;

/**
 * How long a cycle keeps accepting uploads AFTER its reveal instant: one full
 * birthday day. See the module comment for why this is not zero.
 */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;

const MS_PER_MINUTE = 60_000;

/** First cycle year (age 1) and last cycle year (age 17), derived from the registry. */
export const FIRST_CYCLE_YEAR = BIRTH_DATE.year + THEME_MIN_AGE;
export const LAST_CYCLE_YEAR = BIRTH_DATE.year + THEME_MAX_AGE;

/**
 * UTC instant of 27 October `year` at 00:00 UTC+09:00.
 * e.g. 2026 → 2026-10-26T15:00:00.000Z.
 */
export function birthdayBoundaryUtc(year: number): Date {
  return new Date(
    Date.UTC(year, BIRTH_DATE.month - 1, BIRTH_DATE.day) -
      BIRTHDAY_UTC_OFFSET_MINUTES * MS_PER_MINUTE,
  );
}

export interface BirthdayCycle {
  /** Edition age (1–17). */
  age: number;
  /** Full birthday year, e.g. 2026. */
  year: number;
  /** Inclusive start: 00:00 WIT the previous day-after-birthday. */
  start: Date;
  /** Public reveal instant: 00:00 WIT this birthday. */
  revealAt: Date;
  /**
   * Exclusive END of the upload window: 00:00 WIT the day AFTER the birthday.
   * Always later than `revealAt` — see the module comment. Media is assigned to
   * a cycle by this window, NOT by `revealAt`.
   */
  uploadEnd: Date;
}

/** True when `year` maps to a registry age (1–17). */
export function isCycleYear(year: number): boolean {
  return Number.isInteger(year) && year >= FIRST_CYCLE_YEAR && year <= LAST_CYCLE_YEAR;
}

/** Window for a cycle year, or `null` when the year is outside the registry. */
export function cycleWindowForYear(year: number): BirthdayCycle | null {
  if (!isCycleYear(year)) return null;
  const revealAt = birthdayBoundaryUtc(year);
  const previousReveal = birthdayBoundaryUtc(year - 1);
  return {
    age: year - BIRTH_DATE.year,
    year,
    // The window starts the day AFTER the previous birthday, because the
    // previous cycle kept that whole day for its own uploads. This is EXACTLY
    // the previous cycle's `uploadEnd`, so windows never gap or overlap.
    start: new Date(previousReveal.getTime() + UPLOAD_GRACE_MS),
    revealAt,
    uploadEnd: new Date(revealAt.getTime() + UPLOAD_GRACE_MS),
  };
}

/**
 * Cycle whose UPLOAD WINDOW contains `uploadedAt`: `start <= t < uploadEnd`.
 *
 * This is the IDENTITY of a media file — which album it belongs to — and it does
 * not depend on the current time. Use this when asking "which album is this
 * photo in?".
 *
 * Contrast `cycleForDate(now)`, which asks "where would an upload happening NOW
 * go?" and is therefore time-dependent. They differ on the birthday itself.
 */
export function cycleContainingUpload(uploadedAt: number | Date): BirthdayCycle | null {
  const time = uploadedAt instanceof Date ? uploadedAt.getTime() : uploadedAt;
  for (let year = FIRST_CYCLE_YEAR; year <= LAST_CYCLE_YEAR; year += 1) {
    const window = cycleWindowForYear(year);
    if (!window) continue;
    if (time >= window.start.getTime() && time < window.uploadEnd.getTime()) return window;
  }
  return null;
}

/**
 * Cycle that an upload at `now` belongs to: `start <= now < uploadEnd`.
 *
 * NOTE: the end is `uploadEnd`, not `revealAt`. On the birthday itself a cycle
 * is already revealed but still accepting uploads, so both facts hold at once.
 *
 * Returns `null` when `now` is before the first cycle (before birth) or after
 * the last one (age 17's upload window closed).
 */
export function cycleForDate(now: Date): BirthdayCycle | null {
  const time = now.getTime();
  for (let year = FIRST_CYCLE_YEAR; year <= LAST_CYCLE_YEAR; year += 1) {
    const window = cycleWindowForYear(year);
    if (!window) continue;
    if (time >= window.start.getTime() && time < window.uploadEnd.getTime()) return window;
  }
  return null;
}

/**
 * Most recent cycle whose birthday has already happened — the one the public
 * should be shown. `null` before the very first reveal (nothing is public yet).
 */
export function latestRevealedCycle(now: Date): BirthdayCycle | null {
  const time = now.getTime();
  for (let year = LAST_CYCLE_YEAR; year >= FIRST_CYCLE_YEAR; year -= 1) {
    const window = cycleWindowForYear(year);
    if (window && time >= window.revealAt.getTime()) return window;
  }
  return null;
}

/** True once `now` reached the cycle's own birthday (00:00 WIT). */
export function isCycleRevealed(year: number, now: Date): boolean {
  const window = cycleWindowForYear(year);
  return window !== null && now.getTime() >= window.revealAt.getTime();
}
