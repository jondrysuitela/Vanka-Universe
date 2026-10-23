import { describe, expect, it } from "vitest";

import {
  FIRST_EXPERIENCE_OPEN_LABEL,
  experienceLockedMessage,
  isFirstExperienceOpen,
} from "@/lib/birthday/experience-open";

/**
 * Public gate for the Vanka Experience: it opens on Vanka's first birthday,
 * 27 October 2026 00:00 WIT (= 2026-10-26T15:00:00Z). The gate must agree with
 * the server's cycle policy, so the boundaries below are the same instants the
 * API routes use.
 */

const REVEAL = new Date("2026-10-26T15:00:00.000Z");

describe("isFirstExperienceOpen", () => {
  it("is closed one millisecond before the reveal instant", () => {
    expect(isFirstExperienceOpen(new Date(REVEAL.getTime() - 1))).toBe(false);
  });

  it("is open exactly at the reveal instant", () => {
    expect(isFirstExperienceOpen(REVEAL)).toBe(true);
  });

  it("is closed for dates long before the birthday", () => {
    expect(isFirstExperienceOpen(new Date("2026-10-23T05:00:00.000Z"))).toBe(false);
    expect(isFirstExperienceOpen(new Date("2025-10-27T00:00:00.000Z"))).toBe(false);
  });

  it("stays open after the birthday", () => {
    expect(isFirstExperienceOpen(new Date("2026-10-27T15:00:00.000Z"))).toBe(true);
    expect(isFirstExperienceOpen(new Date("2027-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("locked copy", () => {
  it("names the opening date in Indonesian", () => {
    expect(FIRST_EXPERIENCE_OPEN_LABEL).toBe("27 Oktober 2026");
    expect(experienceLockedMessage()).toContain(FIRST_EXPERIENCE_OPEN_LABEL);
  });
});
