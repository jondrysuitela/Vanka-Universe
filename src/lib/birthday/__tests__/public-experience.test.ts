import { describe, expect, it, vi } from "vitest";

import { loadPublicExperience, toLetterDraft } from "@/lib/birthday/public-experience";

const LETTER = {
  title: "Selamat ulang tahun",
  displayDate: "27 Oktober 2026",
  fullText: "Isi surat.",
  sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
  thumbnail: {
    src: "/api/birthday/gallery/media/11111111-1111-4111-8111-111111111111",
    alt: "Vanka",
  },
};

const GALLERY = {
  year: 2026,
  age: 1,
  revealed: true,
  revealAt: "2026-10-26T15:00:00.000Z",
  items: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "image" as const,
      mime: "image/jpeg",
      name: "foto.jpg",
      title: "Foto pertama",
      description: null,
      takenAt: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Route the two public endpoints to fixed responses. */
function fetcherFor(
  letter: { body: unknown; status?: number } = { body: { data: { year: 2026, age: 1, revealed: true, revealAt: "x", letter: LETTER } } },
  gallery: { body: unknown; status?: number } = { body: { data: GALLERY } },
) {
  return vi.fn(async (input: string) => {
    if (input.startsWith("/api/birthday/letter")) {
      return json(letter.body, letter.status ?? 200);
    }
    if (input.startsWith("/api/birthday/gallery")) {
      return json(gallery.body, gallery.status ?? 200);
    }
    return json({ error: { code: "NOT_FOUND" } }, 404);
  });
}

describe("toLetterDraft", () => {
  it("maps the public payload onto the reader's draft shape", () => {
    const draft = toLetterDraft(LETTER);
    expect(draft.title).toBe("Selamat ulang tahun");
    expect(draft.date).toBe("27 Oktober 2026");
    expect(draft.fullText).toBe("Isi surat.");
    expect(draft.sections).toHaveLength(1);
    expect(draft.thumbnail?.src).toContain("/api/birthday/gallery/media/");
  });

  it("gives every section an id, even when the server omits one", () => {
    const draft = toLetterDraft({ ...LETTER, sections: [{ id: "", heading: "x", body: "y" }] });
    expect(draft.sections[0].id).toBe("s1");
  });
});

describe("loadPublicExperience", () => {
  it("loads the server letter and gallery together", async () => {
    const fetcher = fetcherFor();
    const result = await loadPublicExperience(fetcher);

    expect(result.letterFromServer).toBe(true);
    expect(result.letterDraft?.title).toBe("Selamat ulang tahun");
    expect(result.letterUnavailable).toBe(false);
    expect(result.letterLocked).toBe(false);
    expect(result.galleryItems).toHaveLength(1);
    expect(result.galleryUnavailable).toBe(false);
    expect(result.galleryLocked).toBe(false);
  });

  it("reports a locked gate without pretending the letter is missing", async () => {
    const fetcher = fetcherFor(
      { body: { error: { code: "LETTER_LOCKED" } }, status: 403 },
      { body: { error: { code: "GALLERY_LOCKED" } }, status: 403 },
    );
    const result = await loadPublicExperience(fetcher);

    expect(result.letterLocked).toBe(true);
    expect(result.galleryLocked).toBe(true);
    expect(result.letterUnavailable).toBe(false);
    expect(result.galleryUnavailable).toBe(false);
  });

  it("never turns a server failure into an empty gallery", async () => {
    const fetcher = fetcherFor(
      { body: { error: { code: "INTERNAL_ERROR" } }, status: 500 },
      { body: { error: { code: "INTERNAL_ERROR" } }, status: 500 },
    );
    const result = await loadPublicExperience(fetcher);

    expect(result.letterUnavailable).toBe(true);
    expect(result.galleryUnavailable).toBe(true);
    expect(result.letterDraft).toBeNull();
    expect(result.galleryItems).toEqual([]);
  });

  it("keeps the letter readable when only the gallery endpoint fails", async () => {
    const fetcher = fetcherFor(undefined, {
      body: { error: { code: "INTERNAL_ERROR" } },
      status: 500,
    });
    const result = await loadPublicExperience(fetcher);

    expect(result.letterFromServer).toBe(true);
    expect(result.galleryUnavailable).toBe(true);
    expect(result.galleryItems).toEqual([]);
  });

  it("treats an edition with no saved letter as an honest empty state", async () => {
    const fetcher = fetcherFor({
      body: { data: { year: 2026, age: 1, revealed: true, revealAt: "x", letter: null } },
    });
    const result = await loadPublicExperience(fetcher);

    expect(result.letterUnavailable).toBe(true);
    expect(result.letterFromServer).toBe(false);
    expect(result.letterDraft).toBeNull();
  });

  it("treats a network failure as unavailable, never as an empty gallery", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await loadPublicExperience(fetcher);

    expect(result.letterUnavailable).toBe(true);
    expect(result.galleryUnavailable).toBe(true);
  });

  it("asks BOTH endpoints for the same replayed edition year", async () => {
    const fetcher = fetcherFor();
    await loadPublicExperience(fetcher, { year: 2027 });

    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/api/birthday/letter?year=2027");
    expect(urls).toContain("/api/birthday/gallery?year=2027");
  });

  it("uses each endpoint's default cycle when no year is given", async () => {
    const fetcher = fetcherFor();
    await loadPublicExperience(fetcher);

    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("/api/birthday/letter");
    expect(urls).toContain("/api/birthday/gallery");
  });
});
