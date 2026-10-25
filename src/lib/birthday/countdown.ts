export const BIRTHDAY_COUNTDOWN_SECONDS = 15;
export const BIRTHDAY_CELEBRATION_MS = 6500;

/** Seconds remaining, rounded up so the display reaches zero at the deadline. */
export function countdownSecondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** Remaining time is shown as a stable two-digit clock. */
export function formatCountdown(seconds: number): string {
  return `00:${String(Math.max(0, Math.floor(seconds))).padStart(2, "0")}`;
}

/** Delay to the next countdown display change, calculated from the wall clock. */
export function countdownRefreshDelay(targetMs: number, nowMs: number): number {
  const remaining = targetMs - nowMs;
  if (remaining <= 0) return 0;
  if (remaining > BIRTHDAY_COUNTDOWN_SECONDS * 1000) {
    return remaining - BIRTHDAY_COUNTDOWN_SECONDS * 1000;
  }
  return remaining % 1000 || Math.min(1000, remaining);
}
