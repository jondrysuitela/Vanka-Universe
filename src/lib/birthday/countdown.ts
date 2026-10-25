export const BIRTHDAY_COUNTDOWN_SECONDS = 15;
export const BIRTHDAY_CELEBRATION_MS = 4200;

/** Seconds remaining, rounded up so the display reaches zero at the deadline. */
export function countdownSecondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** Remaining time is shown as a stable two-digit clock. */
export function formatCountdown(seconds: number): string {
  return `00:${String(Math.max(0, Math.floor(seconds))).padStart(2, "0")}`;
}
