import { describe, expect, it } from "vitest";

import {
  MAX_GALLERY_ITEMS,
  saveGallerySchema,
} from "@/lib/archive/gallery-schema";

/**
 * Static validation checks for the private-archive gallery contract (4G.39).
 * No database, no rendering: shape only.
 */

const IMG_A = "11111111-1111-4111-8111-111111111111";
const IMG_B = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";

function photo(mediaId: string, overrides: Record<string, unknown> = {}) {
  return {
    mediaId,
    title: "Judul",
    description: "Cerita.",
    memoryDate: null,
    ...overrides,
  };
}

describe("saveGallerySchema", () => {
  it("accepts a valid gallery and preserves photo order", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: VID,
      photos: [photo(IMG_A), photo(IMG_B)],
      videos: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.introMediaId).toBe(VID);
      expect(parsed.data.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
      expect(parsed.data.videos).toEqual([]);
    }
  });

  it("allows a null/omitted intro and defaults memoryDate to null", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [{ mediaId: IMG_A, title: "", description: "" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.photos[0].memoryDate).toBeNull();
      expect(parsed.data.introMediaId).toBeNull();
    }
  });

  it("accepts video gallery items and rejects duplicate media across item types", () => {
    const valid = saveGallerySchema.safeParse({
      introMediaId: VID,
      photos: [photo(IMG_A)],
      videos: [photo(IMG_B)],
    });
    expect(valid.success).toBe(true);

    const duplicate = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [photo(IMG_A)],
      videos: [photo(IMG_A)],
    });
    expect(duplicate.success).toBe(false);
  });

  it("rejects reusing the intro video as a video gallery item", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: VID,
      photos: [],
      videos: [photo(VID)],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown key (a raw src/path cannot be smuggled in)", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [photo(IMG_A, { src: "/storage/media/x.jpg" })],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate photo media ids", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [photo(IMG_A), photo(IMG_A)],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an intro that is also used as a photo", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: IMG_A,
      photos: [photo(IMG_A)],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-uuid media id", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [photo("not-a-uuid")],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid calendar date", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: [photo(IMG_A, { memoryDate: "2026-02-30" })],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects more photos than the cap", () => {
    const photos = Array.from({ length: 201 }, () => photo(IMG_A));
    // Duplicates alone would fail; use distinct ids to isolate the cap check.
    const distinct = photos.map((p, i) => ({ ...p, mediaId: uuidLike(i) }));
    const parsed = saveGallerySchema.safeParse({ introMediaId: null, photos: distinct });
    expect(MAX_GALLERY_ITEMS).toBe(200);
    expect(parsed.success).toBe(false);
  });

  it("caps the combined photo and video gallery at 200 items", () => {
    const parsed = saveGallerySchema.safeParse({
      introMediaId: null,
      photos: Array.from({ length: 150 }, (_, i) => photo(uuidLike(i))),
      videos: Array.from({ length: 51 }, (_, i) => photo(uuidLike(i + 150))),
    });
    expect(parsed.success).toBe(false);
  });
});

function uuidLike(index: number): string {
  const n = (index + 1).toString(16).padStart(8, "0");
  return `${n}-0000-4000-8000-000000000000`;
}
