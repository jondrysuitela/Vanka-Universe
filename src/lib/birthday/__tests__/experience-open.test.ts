import { describe, expect, it } from "vitest";

import {
  FIRST_EXPERIENCE_OPEN_LABEL,
  birthdayDayCycle,
  experienceLockedMessage,
  isFirstExperienceOpen,
  publicExperiencePhase,
} from "@/lib/birthday/experience-open";

/**
 * Public gate for the Vanka Experience. Age 1 is revealed on 27 October 2026
 * 00:00 WIT (= 2026-10-26T15:00:00Z) and its birthday DAY runs until 28 October
 * 00:00 WIT (= 2026-10-27T15:00:00Z). The boundaries below are the same instants
 * the gallery/letter APIs use, so the UI gate cannot drift from the server.
 */

const REVEAL = new Date("2026-10-26T15:00:00.000Z");
const DAY_AFTER = new Date("2026-10-27T15:00:00.000Z");

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
    expect(isFirstExperienceOpen(new Date("2027-01-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("birthdayDayCycle", () => {
  it("is null one millisecond before the reveal", () => {
    expect(birthdayDayCycle(new Date(REVEAL.getTime() - 1))).toBeNull();
  });

  it("is the celebrated cycle on the birthday itself", () => {
    expect(birthdayDayCycle(REVEAL)?.year).toBe(2026);
    expect(birthdayDayCycle(new Date("2026-10-27T10:00:00.000Z"))?.age).toBe(1);
  });

  it("is null from the next day on", () => {
    expect(birthdayDayCycle(DAY_AFTER)).toBeNull();
    expect(birthdayDayCycle(new Date("2027-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("is null a year earlier, even though that window is collecting uploads", () => {
    expect(birthdayDayCycle(new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });
});

describe("publicExperiencePhase", () => {
  it("is before / birthday / archive in that order", () => {
    expect(publicExperiencePhase(new Date("2026-10-23T05:00:00.000Z"))).toBe("before");
    expect(publicExperiencePhase(REVEAL)).toBe("birthday");
    expect(publicExperiencePhase(new Date("2026-10-27T14:59:59.999Z"))).toBe("birthday");
    expect(publicExperiencePhase(DAY_AFTER)).toBe("archive");
    expect(publicExperiencePhase(new Date("2027-03-01T00:00:00.000Z"))).toBe("archive");
  });
});

describe("locked copy", () => {
  it("names the opening date in Indonesian", () => {
    expect(FIRST_EXPERIENCE_OPEN_LABEL).toBe("27 Oktober 2026");
    expect(experienceLockedMessage()).toContain(FIRST_EXPERIENCE_OPEN_LABEL);
  });
});
