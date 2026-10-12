import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LETTER_DRAFT_KEY,
  LETTERS_STORE_KEY,
  deleteLetterForAge,
  listSavedLetterAges,
  loadLetterForAge,
  loadLetterStore,
  saveLetterForAge,
  type LetterDraft,
} from "@/components/birthday/LetterScene";

/** Minimal in-memory Storage implementation. */
function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function draft(title: string): LetterDraft {
  return {
    title,
    date: "",
    fullText: "",
    sections: [{ id: "s1", heading: "", body: title }],
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeStorage() });
});

describe("per-edition letter store (localStorage)", () => {
  it("saves and loads a letter per age", () => {
    saveLetterForAge(2, draft("Surat usia 2"));
    expect(loadLetterForAge(2)?.title).toBe("Surat usia 2");
  });

  it("keeps drafts for different ages isolated", () => {
    saveLetterForAge(1, draft("Ayah"));
    saveLetterForAge(3, draft("Usia 3"));
    expect(loadLetterForAge(1)?.title).toBe("Ayah");
    expect(loadLetterForAge(3)?.title).toBe("Usia 3");
    expect(loadLetterForAge(2)).toBeNull();
  });

  it("deletes only the selected edition", () => {
    saveLetterForAge(2, draft("dua"));
    saveLetterForAge(4, draft("empat"));
    deleteLetterForAge(2);
    expect(loadLetterForAge(2)).toBeNull();
    expect(loadLetterForAge(4)?.title).toBe("empat");
  });

  it("lists saved ages in ascending order", () => {
    saveLetterForAge(5, draft("lima"));
    saveLetterForAge(1, draft("satu"));
    saveLetterForAge(3, draft("tiga"));
    expect(listSavedLetterAges()).toEqual([1, 3, 5]);
  });

  it("falls back to the legacy age-1 draft and clears it on delete", () => {
    window.localStorage.setItem(LETTER_DRAFT_KEY, JSON.stringify(draft("legacy")));
    expect(loadLetterForAge(1)?.title).toBe("legacy");
    expect(listSavedLetterAges()).toContain(1);
    deleteLetterForAge(1);
    expect(loadLetterForAge(1)).toBeNull();
  });

  it("ignores corrupt store data", () => {
    window.localStorage.setItem(LETTERS_STORE_KEY, "{ not json");
    expect(loadLetterStore()).toEqual({});
  });

  it("preserves the opening thumbnail through save + load (the media-page write)", () => {
    // Pustaka Media → "Jadikan Thumbnail" writes exactly this shape into the
    // edition draft; the experience reads it back for the opening frame.
    saveLetterForAge(1, {
      ...draft("Ayah"),
      thumbnail: { src: "/api/media/abc", alt: "Vanka", caption: "Pertama" },
    });
    expect(loadLetterForAge(1)?.thumbnail).toEqual({
      src: "/api/media/abc",
      alt: "Vanka",
      caption: "Pertama",
    });
  });
});
