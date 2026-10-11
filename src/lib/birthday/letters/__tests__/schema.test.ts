import { describe, expect, it } from "vitest";

import { parseLetterAge, upsertBirthdayLetterSchema } from "@/lib/birthday/letters/schema";

const baseDraft = {
  age: 1,
  title: "Selamat ulang tahun",
  displayDate: "27 Oktober 2026",
  fullText: "Isi surat.",
  sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
  thumbnail: null,
};

describe("upsertBirthdayLetterSchema", () => {
  it("accepts a well-formed draft with null thumbnail", () => {
    const parsed = upsertBirthdayLetterSchema.safeParse(baseDraft);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.age).toBe(1);
      expect(parsed.data.thumbnail).toBeNull();
    }
  });

  it("treats an omitted thumbnail as null (no placeholder invented)", () => {
    const parsed = upsertBirthdayLetterSchema.safeParse({
      age: baseDraft.age,
      title: baseDraft.title,
      displayDate: baseDraft.displayDate,
      fullText: baseDraft.fullText,
      sections: baseDraft.sections,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.thumbnail).toBeNull();
  });

  it("accepts a thumbnail that keeps the required alt", () => {
    const parsed = upsertBirthdayLetterSchema.safeParse({
      ...baseDraft,
      thumbnail: { src: "/media/opening.jpg", alt: "Bingkai pembuka" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an out-of-registry age (0, 18, fractional)", () => {
    for (const age of [0, 18, 1.5, -1]) {
      expect(upsertBirthdayLetterSchema.safeParse({ ...baseDraft, age }).success).toBe(false);
    }
  });

  it("rejects a thumbnail without alt", () => {
    expect(
      upsertBirthdayLetterSchema.safeParse({ ...baseDraft, thumbnail: { src: "/x.jpg" } }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (status / authorship / timestamps)", () => {
    for (const forbidden of [
      { status: "published" },
      { edition_id: "11111111-1111-4111-8111-111111111111" },
      { created_by: "admin-1" },
      { published_at: "2026-10-27T00:00:00Z" },
    ]) {
      expect(upsertBirthdayLetterSchema.safeParse({ ...baseDraft, ...forbidden }).success).toBe(false);
    }
  });

  it("rejects a section that carries unknown keys", () => {
    const parsed = upsertBirthdayLetterSchema.safeParse({
      ...baseDraft,
      sections: [{ id: "s1", heading: "H", body: "B", order: 1 }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseLetterAge", () => {
  it("accepts integers in 1–17 only", () => {
    expect(parseLetterAge("1")).toBe(1);
    expect(parseLetterAge("17")).toBe(17);
    for (const bad of ["0", "18", "1.5", "abc", "-1", ""]) {
      expect(parseLetterAge(bad), bad).toBeNull();
    }
  });
});
