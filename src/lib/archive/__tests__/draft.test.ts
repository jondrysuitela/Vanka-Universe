import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_DRAFT_KEY,
  EMPTY_ARCHIVE_DRAFT,
  clearArchiveDraft,
  coerceArchiveDraft,
  hasArchiveContent,
  loadArchiveDraft,
  saveArchiveDraft,
  splitNarrative,
} from "@/lib/archive/draft";

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

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeStorage() });
});

describe("private archive draft store (localStorage)", () => {
  it("returns an empty draft when nothing is stored", () => {
    expect(loadArchiveDraft()).toEqual(EMPTY_ARCHIVE_DRAFT);
  });

  it("saves and loads a draft round-trip", () => {
    saveArchiveDraft({
      title: "Tentang Ibumu",
      narrative: "Paragraf satu.\n\nParagraf dua.",
      musicEnabled: true,
      musicSrc: "/media/ibu.mp3",
    });
    expect(loadArchiveDraft()).toEqual({
      title: "Tentang Ibumu",
      narrative: "Paragraf satu.\n\nParagraf dua.",
      musicEnabled: true,
      musicSrc: "/media/ibu.mp3",
    });
  });

  it("ignores corrupt stored data", () => {
    window.localStorage.setItem(ARCHIVE_DRAFT_KEY, "{ not json");
    expect(loadArchiveDraft()).toEqual(EMPTY_ARCHIVE_DRAFT);
  });

  it("coerces unknown shapes to a safe draft", () => {
    expect(coerceArchiveDraft({ title: 5, musicEnabled: "yes" })).toEqual({
      title: "",
      narrative: "",
      musicEnabled: false,
      musicSrc: "",
    });
  });

  it("clears the draft", () => {
    saveArchiveDraft({ ...EMPTY_ARCHIVE_DRAFT, title: "x" });
    clearArchiveDraft();
    expect(loadArchiveDraft()).toEqual(EMPTY_ARCHIVE_DRAFT);
  });

  it("reports content only for real title/narrative text", () => {
    expect(hasArchiveContent({ ...EMPTY_ARCHIVE_DRAFT, title: "  " })).toBe(false);
    expect(hasArchiveContent({ ...EMPTY_ARCHIVE_DRAFT, narrative: "hai" })).toBe(true);
  });

  it("splits narrative into non-empty paragraphs", () => {
    expect(splitNarrative("a\n\nb\n\n\n  \n\nc")).toEqual(["a", "b", "c"]);
  });
});
