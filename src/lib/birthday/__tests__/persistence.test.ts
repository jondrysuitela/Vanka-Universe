import { describe, expect, it } from "vitest";

import {
  LETTER_DRAFT_KEY,
  LETTERS_STORE_KEY as LETTERS_STORE_KEY_RUNTIME,
  type LetterDraft,
} from "@/components/birthday/LetterScene";
import {
  LEGACY_LETTER_DRAFT_KEY,
  LETTERS_STORE_KEY,
  letterEditionIdentity,
  planLetterImport,
  toLetterPayload,
  validateLetterDraft,
} from "@/lib/birthday/persistence";

function fullDraft(title: string): LetterDraft {
  return {
    title,
    date: "27 Oktober 2026",
    fullText: `${title}\n\nIsi paragraf.`,
    sections: [{ id: "s1", heading: "Bagian 1", body: "Isi paragraf." }],
    thumbnail: { alt: "Bingkai foto pembuka Vanka", caption: "contoh" },
  };
}

describe("persistence contract — keys stay in sync with LetterScene", () => {
  it("mirrors the localStorage keys owned by LetterScene", () => {
    expect(LETTERS_STORE_KEY).toBe(LETTERS_STORE_KEY_RUNTIME);
    expect(LEGACY_LETTER_DRAFT_KEY).toBe(LETTER_DRAFT_KEY);
    expect(LETTERS_STORE_KEY).toBe("vanka.letters.v2");
  });
});

describe("persistence contract — edition identity", () => {
  it("derives deterministic identity from the static theme registry", () => {
    const id = letterEditionIdentity(1);
    expect(id).toEqual({
      age: 1,
      year: 2026,
      editionId: "vanka-birthday-01",
      slug: "vanka-first-universe",
      letterSlug: "birthday-letter-2026",
    });
  });

  it("is stable across calls (no drift)", () => {
    expect(letterEditionIdentity(7)).toEqual(letterEditionIdentity(7));
    expect(letterEditionIdentity(17)?.year).toBe(2042);
  });

  it("returns null for ages outside 1–17 or non-integers", () => {
    expect(letterEditionIdentity(0)).toBeNull();
    expect(letterEditionIdentity(18)).toBeNull();
    expect(letterEditionIdentity(1.5)).toBeNull();
    expect(letterEditionIdentity(Number.NaN)).toBeNull();
  });
});

describe("persistence contract — validation never repairs", () => {
  it("accepts a well-formed draft and returns the SAME reference", () => {
    const draft = fullDraft("Untuk Vanka");
    const result = validateLetterDraft(draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft).toBe(draft);
  });

  it("accepts an empty-but-well-formed draft (new edition, no content)", () => {
    const empty: LetterDraft = { title: "", date: "", fullText: "", sections: [] };
    expect(validateLetterDraft(empty).ok).toBe(true);
  });

  it("rejects non-objects and bad field types with error messages", () => {
    expect(validateLetterDraft(null).ok).toBe(false);
    expect(validateLetterDraft("x").ok).toBe(false);
    const bad = validateLetterDraft({ title: 5, date: "", fullText: "", sections: "nope" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toContain("title harus string");
      expect(bad.errors).toContain("sections harus array");
    }
  });

  it("rejects malformed sections and thumbnails", () => {
    const badSection = validateLetterDraft({
      title: "",
      date: "",
      fullText: "",
      sections: [{ id: "s1", heading: 1, body: "" }],
    });
    expect(badSection.ok).toBe(false);
    if (!badSection.ok) expect(badSection.errors).toContain("sections[0].heading harus string");

    const badThumb = validateLetterDraft({
      title: "",
      date: "",
      fullText: "",
      sections: [],
      thumbnail: { alt: 3 },
    });
    expect(badThumb.ok).toBe(false);
    if (!badThumb.ok) expect(badThumb.errors).toContain("thumbnail.alt harus string");
  });
});

describe("persistence contract — canonical payload", () => {
  it("produces a stable, deterministic payload", () => {
    const identity = letterEditionIdentity(1);
    expect(identity).not.toBeNull();
    if (!identity) return;
    const draft = fullDraft("Untuk Vanka");
    expect(toLetterPayload(identity, draft)).toEqual({
      editionId: "vanka-birthday-01",
      slug: "birthday-letter-2026",
      year: 2026,
      age: 1,
      title: "Untuk Vanka",
      displayDate: "27 Oktober 2026",
      fullText: draft.fullText,
      sections: draft.sections,
      thumbnail: draft.thumbnail,
    });
  });

  it("normalises a missing thumbnail to null", () => {
    const identity = letterEditionIdentity(2);
    if (!identity) throw new Error("identity missing");
    const draft: LetterDraft = { title: "", date: "", fullText: "", sections: [] };
    expect(toLetterPayload(identity, draft).thumbnail).toBeNull();
  });
});

describe("persistence contract — non-destructive import plan", () => {
  it("separates valid, invalid and out-of-range entries", () => {
    const store: Record<string, unknown> = {
      "1": fullDraft("satu"),
      "3": fullDraft("tiga"),
      "2": { title: 5 },
      "99": fullDraft("luar rentang"),
      foo: fullDraft("bukan angka"),
    };
    const before = JSON.stringify(store);

    const plan = planLetterImport(store);

    expect(plan.entries.map((e) => e.age)).toEqual([1, 3]);
    expect(plan.entries.map((e) => e.identity.letterSlug)).toEqual([
      "birthday-letter-2026",
      "birthday-letter-2028",
    ]);
    expect(plan.invalid.map((e) => e.key)).toEqual(["2"]);
    expect(plan.invalid[0].errors).toContain("title harus string");
    expect(plan.outOfRange.sort()).toEqual(["99", "foo"]);

    // No mutation and no data loss reporting.
    expect(JSON.stringify(store)).toBe(before);
    expect(store["2"]).toEqual({ title: 5 });
  });

  it("returns an empty plan for an empty store (no fabricated entries)", () => {
    expect(planLetterImport({})).toEqual({ entries: [], invalid: [], outOfRange: [] });
  });
});
