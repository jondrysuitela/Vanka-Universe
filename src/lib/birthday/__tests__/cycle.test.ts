import { describe, expect, it } from "vitest";

import {
  BIRTHDAY_UTC_OFFSET_MINUTES,
  UPLOAD_GRACE_MS,
  birthdayBoundaryUtc,
  cycleContainingUpload,
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
/** 28 October 2026 00:00 WIT — the day AFTER the birthday, when uploads close. */
const UPLOAD_END_2026 = new Date("2026-10-27T15:00:00.000Z");
/** 28 October 2025 00:00 WIT — the 2026 cycle's first upload instant. */
const START_2026 = new Date("2025-10-27T15:00:00.000Z");

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
  it("reveals on the birthday but keeps uploading for one more day", () => {
    const window = cycleWindowForYear(2026);
    expect(window?.age).toBe(1);
    expect(window?.start.toISOString()).toBe(START_2026.toISOString());
    expect(window?.revealAt.toISOString()).toBe(BOUNDARY_2026.toISOString());
    // The birthday's own photos must still belong to this cycle.
    expect(window?.uploadEnd.toISOString()).toBe(UPLOAD_END_2026.toISOString());
    expect(UPLOAD_GRACE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("never gaps or overlaps the next window", () => {
    const current = cycleWindowForYear(2026)!;
    const next = cycleWindowForYear(2027)!;
    // The next window starts exactly when this one stops accepting uploads.
    expect(next.start.toISOString()).toBe(current.uploadEnd.toISOString());
  });

  it("returns null outside the registry", () => {
    expect(cycleWindowForYear(2025)).toBeNull();
    expect(cycleWindowForYear(2043)).toBeNull();
  });
});

describe("cycleForDate", () => {
  it("is null before the very first cycle starts", () => {
    // 28 Oct 2025 00:00 WIT is the first upload instant.
    expect(cycleForDate(new Date("2025-10-27T14:59:59.999Z"))).toBeNull();
  });

  it("puts an upload before 27 October into that year's cycle", () => {
    // 26 Oct 2026 09:00 WIT → still age 1.
    const cycle = cycleForDate(new Date("2026-10-26T00:00:00.000Z"));
    expect(cycle?.age).toBe(1);
    expect(cycle?.year).toBe(2026);
  });

  it("keeps a photo taken ON the birthday in THAT year's album", () => {
    // 27 Oct 2026 10:00 WIT — mid-party. This is the whole point of the grace
    // day: the birthday's own photos belong to the birthday being celebrated.
    expect(cycleForDate(BOUNDARY_2026)?.year).toBe(2026);
    expect(cycleForDate(BOUNDARY_2026)?.age).toBe(1);
    expect(cycleForDate(new Date("2026-10-27T03:00:00.000Z"))?.year).toBe(2026); // 12:00 WIT
    expect(cycleForDate(new Date("2026-10-27T14:59:59.999Z"))?.year).toBe(2026); // 23:59 WIT
  });

  it("moves to the NEXT cycle once the birthday day is over", () => {
    // 28 Oct 2026 00:00 WIT — the day after the party.
    expect(cycleForDate(UPLOAD_END_2026)?.year).toBe(2027);
    expect(cycleForDate(UPLOAD_END_2026)?.age).toBe(2);
    expect(cycleForDate(new Date(UPLOAD_END_2026.getTime() - 1))?.year).toBe(2026);
  });

  it("is null after the final (age 17) cycle's upload window", () => {
    expect(cycleForDate(new Date("2042-10-27T14:59:59.999Z"))?.age).toBe(17);
    expect(cycleForDate(new Date("2042-10-27T15:00:00.000Z"))).toBeNull();
  });
});

describe("cycleContainingUpload", () => {
  it("identifies the album by upload time, independent of the current time", () => {
    // Taken at the party on 27 Oct 2026 → the 2026 album, forever.
    expect(cycleContainingUpload(new Date("2026-10-27T03:00:00.000Z"))?.year).toBe(2026);
    // Taken the day after → the 2027 album.
    expect(cycleContainingUpload(UPLOAD_END_2026)?.year).toBe(2027);
  });

  it("agrees with cycleForDate for a photo taken BEFORE the birthday day", () => {
    const taken = new Date("2026-05-01T00:00:00.000Z");
    expect(cycleContainingUpload(taken)?.year).toBe(cycleForDate(taken)?.year);
  });

  it("names the album that is STILL open on the birthday (why it exists)", () => {
    // On the birthday the cycle is already revealed but still accepting
    // uploads. Asking "which album does this photo belong to?" must answer the
    // OPEN one (2026), not "where would a new upload go next year".
    const noon = new Date("2026-10-27T03:00:00.000Z");
    expect(cycleContainingUpload(noon)?.year).toBe(2026);
    expect(isCycleRevealed(2026, noon)).toBe(true);
    // And the next cycle has not started yet at that instant.
    expect(cycleWindowForYear(2027)!.start.getTime()).toBeGreaterThan(noon.getTime());
  });

  it("returns null outside every upload window", () => {
    expect(cycleContainingUpload(new Date("2025-10-27T14:59:59.999Z"))).toBeNull();
    expect(cycleContainingUpload(new Date("2042-10-27T15:00:00.000Z"))).toBeNull();
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
