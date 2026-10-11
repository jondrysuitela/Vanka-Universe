import { describe, expect, it } from "vitest";

import {
  ARCHIVE_PIN_UI_LENGTH,
  ARCHIVE_VISITOR_MESSAGES,
  accessErrorMessage,
  experienceMediaUrl,
  formatMemoryDate,
  mapAccessOutcome,
  mapExperienceOutcome,
  narrativeParagraphs,
  parseVisitorExperience,
} from "@/lib/archive/visitor";
import {
  ARCHIVE_PIN_MAX_LENGTH,
  ARCHIVE_PIN_MIN_LENGTH,
  ARCHIVE_PIN_PATTERN,
} from "@/lib/archive/access/policy";

describe("six-digit PIN UI stays within the server policy", () => {
  it("keeps the rendered box count inside the unchanged 4–12 digit range", () => {
    expect(ARCHIVE_PIN_UI_LENGTH).toBeGreaterThanOrEqual(ARCHIVE_PIN_MIN_LENGTH);
    expect(ARCHIVE_PIN_UI_LENGTH).toBeLessThanOrEqual(ARCHIVE_PIN_MAX_LENGTH);
    // A six-digit value passes the server's own format check unchanged.
    expect(ARCHIVE_PIN_PATTERN.test("1".repeat(ARCHIVE_PIN_UI_LENGTH))).toBe(true);
  });
});

describe("mapAccessOutcome", () => {
  it("classifies every PIN-submit status safely", () => {
    expect(mapAccessOutcome(200)).toBe("unlocked");
    expect(mapAccessOutcome(401)).toBe("invalid_pin");
    // A bad format (422) must not reveal whether a PIN/archive exists.
    expect(mapAccessOutcome(422)).toBe("invalid_pin");
    expect(mapAccessOutcome(429)).toBe("rate_limited");
    expect(mapAccessOutcome(503)).toBe("unavailable");
    expect(mapAccessOutcome(500)).toBe("error");
  });
});

describe("accessErrorMessage", () => {
  it("returns a distinct, non-enumerating message for each outcome", () => {
    const messages = [
      accessErrorMessage("invalid_pin"),
      accessErrorMessage("rate_limited"),
      accessErrorMessage("unavailable"),
      accessErrorMessage("error"),
    ];
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
    expect(accessErrorMessage("invalid_pin")).toBe(ARCHIVE_VISITOR_MESSAGES.invalidPin);
    // Never confirms or denies the existence of an archive.
    expect(accessErrorMessage("invalid_pin").toLowerCase()).not.toContain("arsip");
  });
});

describe("mapExperienceOutcome", () => {
  it("maps status to a load outcome", () => {
    expect(mapExperienceOutcome(200)).toBe("ok");
    expect(mapExperienceOutcome(401)).toBe("unauthorized");
    expect(mapExperienceOutcome(503)).toBe("not_ready");
    expect(mapExperienceOutcome(500)).toBe("error");
  });
});

describe("experienceMediaUrl", () => {
  it("points only at the authenticated visitor proxy and encodes the id", () => {
    expect(experienceMediaUrl("abc-123")).toBe("/api/archive/experience/media/abc-123");
    expect(experienceMediaUrl("a b/c")).toBe("/api/archive/experience/media/a%20b%2Fc");
  });
});

describe("parseVisitorExperience", () => {
  it("parses a full payload without trusting it", () => {
    const parsed = parseVisitorExperience({
      title: "Tentang Ibumu",
      narrative: "Baris satu.\n\nBaris dua.",
      musicEnabled: true,
      introMediaId: "vid-1",
      photos: [
        { mediaId: "img-1", title: "A", description: "B", memoryDate: "2020-01-01", position: 0 },
      ],
    });
    expect(parsed).toEqual({
      title: "Tentang Ibumu",
      narrative: "Baris satu.\n\nBaris dua.",
      musicEnabled: true,
      introMediaId: "vid-1",
      photos: [
        { mediaId: "img-1", title: "A", description: "B", memoryDate: "2020-01-01", position: 0 },
      ],
    });
  });

  it("returns an honest empty view for a null-ish payload", () => {
    expect(parseVisitorExperience(null)).toBeNull();
    expect(parseVisitorExperience("nope")).toBeNull();
    expect(parseVisitorExperience({})).toEqual({
      title: "",
      narrative: "",
      musicEnabled: false,
      introMediaId: null,
      photos: [],
    });
  });

  it("drops malformed photos and coerces missing fields", () => {
    const parsed = parseVisitorExperience({
      title: 5,
      musicEnabled: "yes",
      introMediaId: "",
      photos: [null, { mediaId: "" }, { mediaId: "img-1" }, "x"],
    });
    expect(parsed?.title).toBe("");
    expect(parsed?.musicEnabled).toBe(false);
    expect(parsed?.introMediaId).toBeNull();
    expect(parsed?.photos).toHaveLength(1);
    expect(parsed?.photos[0]).toMatchObject({ mediaId: "img-1", title: "", memoryDate: null });
  });
});

describe("formatMemoryDate", () => {
  it("formats ISO dates with literal parts (no timezone shift)", () => {
    expect(formatMemoryDate("2020-01-01")).toBe("1 Januari 2020");
    expect(formatMemoryDate("2026-10-27T15:30:00.000Z")).toBe("27 Oktober 2026");
  });

  it("passes through unparseable values and null", () => {
    expect(formatMemoryDate(null)).toBeNull();
    expect(formatMemoryDate("")).toBeNull();
    expect(formatMemoryDate("tanggal tercinta")).toBe("tanggal tercinta");
    expect(formatMemoryDate("2020-13-40")).toBe("2020-13-40");
  });
});

describe("narrativeParagraphs", () => {
  it("splits on blank lines and drops empties", () => {
    expect(narrativeParagraphs("A\n\nB\n\n\nC")).toEqual(["A", "B", "C"]);
    expect(narrativeParagraphs("   ")).toEqual([]);
    expect(narrativeParagraphs("")).toEqual([]);
  });
});
