import { describe, expect, it } from "vitest";

import { PRIVATE_ARCHIVE_SLUG, upsertArchiveSchema } from "@/lib/archive/schema";
import { validatePrivateAudioReference } from "@/lib/archive/media-link";

const base = {
  title: "Tentang Ibumu",
  narrative: "Paragraf satu.\n\nParagraf dua.",
  musicEnabled: false,
  musicMediaId: null,
};

describe("upsertArchiveSchema", () => {
  it("accepts a well-formed private-archive draft", () => {
    const parsed = upsertArchiveSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.musicMediaId).toBeNull();
  });

  it("defaults an omitted musicMediaId to null", () => {
    const parsed = upsertArchiveSchema.safeParse({
      title: base.title,
      narrative: base.narrative,
      musicEnabled: base.musicEnabled,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.musicMediaId).toBeNull();
  });

  it("accepts a valid media UUID reference", () => {
    const parsed = upsertArchiveSchema.safeParse({
      ...base,
      musicMediaId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-UUID media reference", () => {
    expect(upsertArchiveSchema.safeParse({ ...base, musicMediaId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a raw filesystem path / public URL (musicSrc)", () => {
    for (const src of ["/audio/music.mp3", "https://cdn.example/x.mp3", "C:\\music\\a.mp3"]) {
      expect(upsertArchiveSchema.safeParse({ ...base, musicSrc: src }).success, src).toBe(false);
    }
  });

  it("rejects client-supplied privacy/status/slug/id", () => {
    for (const forbidden of [
      { privacy: "public" },
      { status: "archived" },
      { slug: "other" },
      { id: "11111111-1111-4111-8111-111111111111" },
      { created_by: "admin-1" },
    ]) {
      expect(upsertArchiveSchema.safeParse({ ...base, ...forbidden }).success).toBe(false);
    }
  });

  it("pins the singleton slug constant", () => {
    expect(PRIVATE_ARCHIVE_SLUG).toBe("tentang-ibumu");
  });
});

describe("validatePrivateAudioReference", () => {
  it("allows null (no asset chosen)", () => {
    expect(validatePrivateAudioReference(null).ok).toBe(true);
  });

  it("fail-closed: rejects any non-null reference today", () => {
    const verdict = validatePrivateAudioReference("11111111-1111-4111-8111-111111111111");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/audio/i);
  });
});
