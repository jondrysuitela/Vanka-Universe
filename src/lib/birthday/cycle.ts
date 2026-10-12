import {
  BIRTH_DATE,
  THEME_MAX_AGE,
  THEME_MIN_AGE,
} from "@/lib/birthday/theme-registry";

/**
 * Birthday cycle policy (public-reveal window).
 *
 * Vanka's birthday is 27 October. Every uploaded photo/video belongs to the
 * birthday cycle it was uploaded in: media uploaded BEFORE 27 October belongs to
 * that year's celebration, media uploaded ON/AFTER 27 October belongs to the
 * following year's celebration. The same boundary decides when a cycle becomes
 * visible to the public: a cycle is revealed at 00:00 on its own birthday.
 *
 * Time anchor: 27 October 00:00 at UTC+09:00 (Indonesia Timur / WIT). Boundaries
 * are therefore fixed UTC instants, so the rule is deterministic and testable —
 * no local-machine timezone is ever consulted.
 *
 * PURE: no I/O, no clock reads. Callers pass `now` explicitly.
 */

/** Fixed birthday timezone offset: UTC+09:00 (Indonesia Timur). */
export const BIRTHDAY_UTC_OFFSET_MINUTES = 9 * 60;

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
  /** Inclusive start: 00:00 WIT the previous birthday. */
  start: Date;
  /** Exclusive end, equal to the public reveal instant: 00:00 WIT this birthday. */
  revealAt: Date;
}

/** True when `year` maps to a registry age (1–17). */
export function isCycleYear(year: number): boolean {
  return Number.isInteger(year) && year >= FIRST_CYCLE_YEAR && year <= LAST_CYCLE_YEAR;
}

/** Window for a cycle year, or `null` when the year is outside the registry. */
export function cycleWindowForYear(year: number): BirthdayCycle | null {
  if (!isCycleYear(year)) return null;
  return {
    age: year - BIRTH_DATE.year,
    year,
    start: birthdayBoundaryUtc(year - 1),
    revealAt: birthdayBoundaryUtc(year),
  };
}

/**
 * Cycle that `now` falls into: `start <= now < revealAt`, or `null` when `now`
 * is before the first cycle (before birth) or after the last one (age 17).
 *
 * This is the PREPARATION cycle: where a media uploaded right now belongs.
 */
export function cycleForDate(now: Date): BirthdayCycle | null {
  const time = now.getTime();
  for (let year = FIRST_CYCLE_YEAR; year <= LAST_CYCLE_YEAR; year += 1) {
    const window = cycleWindowForYear(year);
    if (!window) continue;
    if (time >= window.start.getTime() && time < window.revealAt.getTime()) return window;
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
