import { describe, expect, it } from "vitest";

import {
  editionHref,
  listPublicEditions,
  newestPublicEdition,
} from "@/lib/birthday/public-editions";
import { BIRTHDAY_THEMES } from "@/lib/birthday/theme-registry";

/**
 * Memory Archive edition list: every birthday becomes its own chapter, ordered
 * newest first, dressed in that year's theme, and hidden until its own reveal
 * instant (27 October, 00:00 WIT).
 */

const REVEAL_2026 = new Date("2026-10-26T15:00:00.000Z");
const REVEAL_2027 = new Date("2027-10-26T15:00:00.000Z");

describe("listPublicEditions", () => {
  it("is empty before the very first birthday", () => {
    expect(listPublicEditions(new Date("2026-10-23T05:00:00.000Z"))).toEqual([]);
  });

  it("lists only the years whose birthday has happened", () => {
    const editions = listPublicEditions(new Date("2026-11-15T00:00:00.000Z"));
    expect(editions.map((edition) => edition.year)).toEqual([2026]);
  });

  it("puts the newest birthday first and keeps the whole history", () => {
    const editions = listPublicEditions(REVEAL_2027);
    expect(editions.map((edition) => edition.year)).toEqual([2027, 2026]);
    expect(editions.map((edition) => edition.age)).toEqual([2, 1]);
  });

  it("does not list a year one millisecond before its reveal", () => {
    const editions = listPublicEditions(new Date(REVEAL_2027.getTime() - 1));
    expect(editions.map((edition) => edition.year)).toEqual([2026]);
  });

  it("takes title, note and palette from that year's theme", () => {
    const [first] = listPublicEditions(REVEAL_2026);
    const theme = BIRTHDAY_THEMES.find((entry) => entry.age === 1)!;

    expect(first.title).toBe(theme.title);
    expect(first.subtitle).toBe(theme.subtitle);
    expect(first.readinessNote).toBe(theme.readinessNote);
    expect(first.palette).toEqual(theme.palette);
    expect(first.dateLabel).toBe("27 Oktober 2026");
  });

  it("reports the birthday day only on that one day", () => {
    expect(listPublicEditions(REVEAL_2026)[0].isBirthdayToday).toBe(true);
    expect(
      listPublicEditions(new Date("2026-10-26T14:59:59.999Z"))[0]?.isBirthdayToday,
    ).toBeUndefined(); // still hidden: the list is empty
    expect(
      listPublicEditions(new Date("2026-10-27T15:00:00.000Z"))[0].isBirthdayToday,
    ).toBe(false);
  });
});

describe("newestPublicEdition", () => {
  it("is null before the first birthday and the latest year afterwards", () => {
    expect(newestPublicEdition(new Date("2026-10-23T05:00:00.000Z"))).toBeNull();
    expect(newestPublicEdition(new Date("2026-12-01T00:00:00.000Z"))?.year).toBe(2026);
    expect(newestPublicEdition(REVEAL_2027)?.year).toBe(2027);
  });
});

describe("editionHref", () => {
  it("points at the public replay URL of that edition", () => {
    expect(editionHref(1)).toBe("/birthday-experience?edition=1");
    expect(editionHref(3)).toBe("/birthday-experience?edition=3");
  });
});
