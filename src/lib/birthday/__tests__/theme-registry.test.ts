import { describe, expect, it } from "vitest";

import {
  BIRTHDAY_THEMES,
  BIRTH_DATE,
  FIRST_THEME_AGE,
  THEME_MAX_AGE,
  THEME_MIN_AGE,
  birthdayIsoDate,
  birthdayYear,
  formatBirthdayDate,
  getThemeByAge,
  getThemeBySlug,
  type BirthdayTheme,
} from "../theme-registry";

const REQUIRED_STRING_FIELDS: Array<keyof BirthdayTheme> = [
  "id",
  "title",
  "subtitle",
  "slug",
  "concept",
  "background",
  "animation",
  "transition",
  "opening",
  "letter",
  "gallery",
  "readinessNote",
];

describe("birthday theme registry", () => {
  it("has exactly 17 themes", () => {
    expect(BIRTHDAY_THEMES).toHaveLength(17);
  });

  it("covers every age 1–17 exactly once, in ascending order", () => {
    const ages = BIRTHDAY_THEMES.map((t) => t.age);
    expect(ages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(new Set(ages).size).toBe(ages.length);
    expect(Math.min(...ages)).toBe(THEME_MIN_AGE);
    expect(Math.max(...ages)).toBe(THEME_MAX_AGE);
  });

  it("has unique slugs and unique ids", () => {
    const slugs = BIRTHDAY_THEMES.map((t) => t.slug);
    const ids = BIRTHDAY_THEMES.map((t) => t.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses URL-safe, stable slug format", () => {
    for (const theme of BIRTHDAY_THEMES) {
      expect(theme.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("computes the birthday year from the birth date (2025 + age)", () => {
    expect(BIRTH_DATE).toEqual({ year: 2025, month: 10, day: 27 });
    for (const theme of BIRTHDAY_THEMES) {
      expect(theme.year).toBe(birthdayYear(theme.age));
      expect(theme.year).toBe(2025 + theme.age);
    }
    expect(birthdayYear(1)).toBe(2026);
    expect(birthdayYear(17)).toBe(2042);
  });

  it("keeps the first birthday on 27 October 2026", () => {
    const first = getThemeByAge(FIRST_THEME_AGE);
    expect(first).toBeDefined();
    expect(first?.year).toBe(2026);
    expect(formatBirthdayDate(1)).toBe("27 Oktober 2026");
    expect(birthdayIsoDate(1)).toBe("2026-10-27");
  });

  it("keeps age 1 matching the currently built experience", () => {
    const first = getThemeByAge(1);
    expect(first?.title).toBe("Vanka's First Universe");
    expect(first?.slug).toBe("vanka-first-universe");
    expect(first?.year).toBe(2026);
    expect(first?.readiness).toBe("implemented");
  });

  it("marks every other age as not-yet-implemented (concept)", () => {
    for (const theme of BIRTHDAY_THEMES) {
      if (theme.age === 1) continue;
      expect(theme.readiness).toBe("concept");
    }
  });

  it("provides non-empty required fields and a valid palette for every theme", () => {
    for (const theme of BIRTHDAY_THEMES) {
      for (const field of REQUIRED_STRING_FIELDS) {
        const value = theme[field];
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
      const colors = [
        theme.palette.primary,
        theme.palette.secondary,
        theme.palette.accent,
        theme.palette.surface,
        theme.palette.text,
      ];
      for (const color of colors) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(theme.palette.gradient).toHaveLength(3);
      for (const stop of theme.palette.gradient) {
        expect(stop).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("looks up by age and slug, returning undefined when unknown", () => {
    expect(getThemeByAge(1)?.slug).toBe("vanka-first-universe");
    expect(getThemeByAge(17)?.slug).toBe("the-universe-ahead");
    expect(getThemeByAge(0)).toBeUndefined();
    expect(getThemeByAge(18)).toBeUndefined();

    expect(getThemeBySlug("vanka-first-universe")?.age).toBe(1);
    expect(getThemeBySlug("letters-across-time")?.age).toBe(16);
    expect(getThemeBySlug("does-not-exist")).toBeUndefined();
  });
});
