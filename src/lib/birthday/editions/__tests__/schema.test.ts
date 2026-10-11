import { describe, expect, it } from "vitest";

import { createBirthdayEditionSchema } from "@/lib/birthday/editions/schema";
import { letterEditionIdentity } from "@/lib/birthday/persistence";
import { getThemeByAge, THEME_MAX_AGE, THEME_MIN_AGE } from "@/lib/birthday/theme-registry";

describe("createBirthdayEditionSchema", () => {
  it("accepts only the age field", () => {
    const parsed = createBirthdayEditionSchema.safeParse({ age: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ age: 1 });
  });

  it("rejects out-of-registry and non-integer ages", () => {
    for (const age of [0, 18, 1.5, -3, "1"]) {
      expect(createBirthdayEditionSchema.safeParse({ age }).success, String(age)).toBe(false);
    }
  });

  it("rejects any client-controlled field (year/title/status/privacy/id/authorship)", () => {
    for (const forbidden of [
      { year: 2026 },
      { title: "Hacked" },
      { subtitle: "x" },
      { status: "published" },
      { privacy: "public" },
      { id: "11111111-1111-4111-8111-111111111111" },
      { created_by: "admin-1" },
      { published_at: "2026-10-27T00:00:00Z" },
    ]) {
      expect(
        createBirthdayEditionSchema.safeParse({ age: 1, ...forbidden }).success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });
});

describe("edition registry alignment with the letters contract", () => {
  it("derives the same year the letter POST resolves for every age", () => {
    for (let age = THEME_MIN_AGE; age <= THEME_MAX_AGE; age += 1) {
      const identity = letterEditionIdentity(age);
      const theme = getThemeByAge(age);
      expect(identity, `identity ${age}`).not.toBeNull();
      expect(theme, `theme ${age}`).toBeDefined();
      // Editions INSERT year = identity.year; letters POST looks up year = identity.year.
      expect(theme?.year).toBe(identity?.year);
    }
  });
});
