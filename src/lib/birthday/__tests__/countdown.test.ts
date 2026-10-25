import { describe, expect, it } from "vitest";

import {
  BIRTHDAY_COUNTDOWN_SECONDS,
  countdownRefreshDelay,
  countdownSecondsUntil,
  formatCountdown,
} from "@/lib/birthday/countdown";

describe("birthday midnight countdown", () => {
  it("starts fifteen seconds before the reveal boundary", () => {
    const revealAt = Date.parse("2026-10-26T15:00:00.000Z");

    expect(countdownSecondsUntil(revealAt, revealAt - BIRTHDAY_COUNTDOWN_SECONDS * 1000)).toBe(15);
  });

  it("rounds up between ticks and reaches zero at midnight", () => {
    const revealAt = Date.parse("2026-10-26T15:00:00.000Z");

    expect(countdownSecondsUntil(revealAt, revealAt - 1)).toBe(1);
    expect(countdownSecondsUntil(revealAt, revealAt)).toBe(0);
    expect(countdownSecondsUntil(revealAt, revealAt + 1000)).toBe(0);
  });

  it("formats seconds as a two-digit countdown", () => {
    expect(formatCountdown(15)).toBe("00:15");
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("schedules updates against the target wall clock instead of accumulating interval drift", () => {
    const revealAt = Date.parse("2026-10-26T15:00:00.000Z");

    expect(countdownRefreshDelay(revealAt, revealAt - 30_000)).toBe(15_000);
    expect(countdownRefreshDelay(revealAt, revealAt - 14_500)).toBe(500);
    expect(countdownRefreshDelay(revealAt, revealAt - 1000)).toBe(1000);
    expect(countdownRefreshDelay(revealAt, revealAt)).toBe(0);
  });
});
