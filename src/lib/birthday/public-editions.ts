import { cycleWindowForYear, isCycleRevealed } from "@/lib/birthday/cycle";
import {
  BIRTHDAY_THEMES,
  formatBirthdayDate,
  type BirthdayTheme,
  type ThemeReadiness,
} from "@/lib/birthday/theme-registry";

/**
 * The public edition list of the Memory Archive (Memory Archive chapter).
 *
 * Every birthday keeps its own chapter, ordered by year, and its LAYOUT comes
 * from that year's theme in the static registry (`theme-registry.ts`) — the
 * same catalog the admin sees. Nothing is invented here: the title, subtitle,
 * palette and readiness note are the theme's own fields.
 *
 * REVEAL RULE: an edition is listed only once its birthday has happened
 * (`isCycleRevealed`). A future edition is never previewed publicly, exactly
 * like the experience and the gallery API.
 *
 * PURE: no I/O, no clock reads. Callers pass `now` explicitly.
 */

export interface PublicEdition {
  /** Birthday year, e.g. 2026. */
  year: number;
  /** Age celebrated (1–17). */
  age: number;
  title: string;
  subtitle: string;
  /** Human date, e.g. "27 Oktober 2026". */
  dateLabel: string;
  /** Whether an experience has actually been built for this age. */
  readiness: ThemeReadiness;
  /** The theme's own honest note about what exists. */
  readinessNote: string;
  palette: BirthdayTheme["palette"];
  /** True on the birthday itself (00:00 → next 00:00 WIT). */
  isBirthdayToday: boolean;
}

/** Replay URL of one edition's experience. */
export function editionHref(age: number): string {
  return `/birthday-experience?edition=${age}`;
}

function isBirthdayToday(theme: BirthdayTheme, now: Date): boolean {
  // The birthday day is the cycle's own one-day `revealAt..uploadEnd` window —
  // see `cycle.ts`. Any other day of the year is outside it.
  const window = cycleWindowForYear(theme.year);
  if (!window) return false;
  const time = now.getTime();
  return time >= window.revealAt.getTime() && time < window.uploadEnd.getTime();
}

/**
 * Revealed editions, NEWEST FIRST (the most recent birthday leads the archive).
 *
 * Only revealed years are returned; `themes` is injectable for tests.
 */
export function listPublicEditions(
  now: Date,
  themes: readonly BirthdayTheme[] = BIRTHDAY_THEMES,
): PublicEdition[] {
  return themes
    .filter((theme) => isCycleRevealed(theme.year, now))
    .sort((a, b) => b.year - a.year)
    .map((theme) => ({
      year: theme.year,
      age: theme.age,
      title: theme.title,
      subtitle: theme.subtitle,
      dateLabel: formatBirthdayDate(theme.age),
      readiness: theme.readiness,
      readinessNote: theme.readinessNote,
      palette: theme.palette,
      isBirthdayToday: isBirthdayToday(theme, now),
    }));
}

/** The newest revealed edition, or null before the very first birthday. */
export function newestPublicEdition(
  now: Date,
  themes: readonly BirthdayTheme[] = BIRTHDAY_THEMES,
): PublicEdition | null {
  return listPublicEditions(now, themes)[0] ?? null;
}
