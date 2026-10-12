import { describe, expect, it } from "vitest";

import {
  toPublicLetter,
  toPublicThumbnail,
  toPublicThumbnailSrc,
} from "@/lib/birthday/letters/public-view";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

describe("toPublicThumbnailSrc", () => {
  it("rewrites the private admin media route to the date-gated public one", () => {
    expect(toPublicThumbnailSrc(`/api/media/${MEDIA_ID}`)).toBe(
      `/api/birthday/gallery/media/${MEDIA_ID}`,
    );
  });

  it("leaves a plain public path untouched", () => {
    expect(toPublicThumbnailSrc("/media/vanka-opening.jpg")).toBe("/media/vanka-opening.jpg");
    expect(toPublicThumbnailSrc("https://cdn.example/vanka.jpg")).toBe(
      "https://cdn.example/vanka.jpg",
    );
  });

  it("leaves a malformed admin path untouched (never fabricates a route)", () => {
    expect(toPublicThumbnailSrc("/api/media/not-a-uuid")).toBe("/api/media/not-a-uuid");
    expect(toPublicThumbnailSrc("/api/media/")).toBe("/api/media/");
  });
});

describe("toPublicThumbnail", () => {
  it("returns null when no thumbnail was set", () => {
    expect(toPublicThumbnail(null)).toBeNull();
  });

  it("keeps the honest placeholder (no src) as-is", () => {
    expect(toPublicThumbnail({ alt: "Bingkai foto pembuka" })).toEqual({
      alt: "Bingkai foto pembuka",
    });
  });

  it("rewrites src while preserving alt and caption", () => {
    expect(
      toPublicThumbnail({ src: `/api/media/${MEDIA_ID}`, alt: "Vanka", caption: "Pertama" }),
    ).toEqual({
      src: `/api/birthday/gallery/media/${MEDIA_ID}`,
      alt: "Vanka",
      caption: "Pertama",
    });
  });
});

describe("toPublicLetter", () => {
  it("maps the row and rewrites the opening frame", () => {
    const letter = toPublicLetter({
      id: "row-1",
      edition_id: "edition-1",
      year: 2026,
      title: "Selamat ulang tahun",
      display_date: "27 Oktober 2026",
      full_text: "Isi surat.",
      sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
      thumbnail: { src: `/api/media/${MEDIA_ID}`, alt: "Vanka" },
      status: "draft",
      created_by: "owner",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    expect(letter).toEqual({
      title: "Selamat ulang tahun",
      displayDate: "27 Oktober 2026",
      fullText: "Isi surat.",
      sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
      thumbnail: { src: `/api/birthday/gallery/media/${MEDIA_ID}`, alt: "Vanka" },
    });
  });
});
