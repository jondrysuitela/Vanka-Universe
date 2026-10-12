import { describe, expect, it } from "vitest";

import {
  BIRTHDAY_UTC_OFFSET_MINUTES,
  birthdayBoundaryUtc,
  cycleForDate,
  cycleWindowForYear,
  isCycleRevealed,
  isCycleYear,
  latestRevealedCycle,
} from "@/lib/birthday/cycle";

/**
 * Birthday cycle policy tests (Tahap 4G.42).
 *
 * Anchor: 27 October 00:00 at UTC+09:00 (WIT). 2026-10-26T15:00:00Z is therefore
 * exactly the 2026 birthday boundary, and 2025-10-26T15:00:00Z the 2026 cycle's
 * start.
 */

const BOUNDARY_2026 = new Date("2026-10-26T15:00:00.000Z");
const START_2026 = new Date("2025-10-26T15:00:00.000Z");

describe("birthdayBoundaryUtc", () => {
  it("anchors 27 October to 00:00 UTC+09:00", () => {
    expect(BIRTHDAY_UTC_OFFSET_MINUTES).toBe(9 * 60);
    expect(birthdayBoundaryUtc(2026).toISOString()).toBe(BOUNDARY_2026.toISOString());
  });
});

describe("isCycleYear", () => {
  it("accepts only registry years (age 1–17)", () => {
    expect(isCycleYear(2026)).toBe(true);
    expect(isCycleYear(2042)).toBe(true);
    expect(isCycleYear(2025)).toBe(false);
    expect(isCycleYear(2043)).toBe(false);
    expect(isCycleYear(2026.5)).toBe(false);
  });
});

describe("cycleWindowForYear", () => {
  it("spans the previous birthday to the own birthday (half-open)", () => {
    const window = cycleWindowForYear(2026);
    expect(window?.age).toBe(1);
    expect(window?.start.toISOString()).toBe(START_2026.toISOString());
    expect(window?.revealAt.toISOString()).toBe(BOUNDARY_2026.toISOString());
  });

  it("returns null outside the registry", () => {
    expect(cycleWindowForYear(2025)).toBeNull();
    expect(cycleWindowForYear(2043)).toBeNull();
  });
});

describe("cycleForDate", () => {
  it("is null before the very first cycle starts", () => {
    expect(cycleForDate(new Date("2025-10-26T14:59:59.999Z"))).toBeNull();
  });

  it("puts an upload before 27 October into that year's cycle", () => {
    // 26 Oct 2026 09:00 WIT → still age 1.
    const cycle = cycleForDate(new Date("2026-10-26T00:00:00.000Z"));
    expect(cycle?.age).toBe(1);
    expect(cycle?.year).toBe(2026);
  });

  it("puts an upload at 27 October 00:00 WIT into the NEXT cycle", () => {
    const cycle = cycleForDate(BOUNDARY_2026);
    expect(cycle?.age).toBe(2);
    expect(cycle?.year).toBe(2027);
  });

  it("keeps the whole 2026 cycle under age 1", () => {
    const justBefore = cycleForDate(new Date(BOUNDARY_2026.getTime() - 1));
    expect(justBefore?.age).toBe(1);
    expect(justBefore?.year).toBe(2026);
  });

  it("is null after the final (age 17) cycle's birthday", () => {
    expect(cycleForDate(new Date("2042-10-26T14:59:59.999Z"))?.age).toBe(17);
    expect(cycleForDate(new Date("2042-10-26T15:00:00.000Z"))).toBeNull();
  });
});

describe("isCycleRevealed", () => {
  it("stays locked until the cycle's own birthday instant", () => {
    expect(isCycleRevealed(2026, new Date(BOUNDARY_2026.getTime() - 1))).toBe(false);
    expect(isCycleRevealed(2026, BOUNDARY_2026)).toBe(true);
  });

  it("is false for an out-of-registry year", () => {
    expect(isCycleRevealed(2043, new Date("2043-01-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("latestRevealedCycle", () => {
  it("is null before the very first birthday", () => {
    expect(latestRevealedCycle(new Date(BOUNDARY_2026.getTime() - 1))).toBeNull();
  });

  it("picks the most recent celebrated birthday after a reveal", () => {
    // After the 2026 birthday: age 1 is public, age 2 is still being prepared.
    const revealed = latestRevealedCycle(new Date("2026-11-01T00:00:00.000Z"));
    expect(revealed?.age).toBe(1);
    expect(revealed?.year).toBe(2026);
  });

  it("advances to the next cycle after the following birthday", () => {
    const revealed = latestRevealedCycle(new Date("2027-11-01T00:00:00.000Z"));
    expect(revealed?.age).toBe(2);
    expect(revealed?.year).toBe(2027);
  });
});
