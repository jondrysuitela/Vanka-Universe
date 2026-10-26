import { describe, expect, it } from "vitest";

import {
  type FetchLike,
  type ServerGallery,
} from "@/lib/archive/gallery-sync";
import {
  experienceNote,
  initialPhase,
  loadExperience,
  nextPhase,
  resolveExperience,
  type Experience,
} from "@/lib/archive/experience";

interface FakeResponse {
  status: number;
  body?: unknown;
  networkError?: boolean;
}
interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetcher(script: FakeResponse[] | ((call: Call, index: number) => FakeResponse)) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const call: Call = { url, init };
    calls.push(call);
    const step = typeof script === "function" ? script(call, calls.length - 1) : script[calls.length - 1];
    if (!step) throw new Error(`no fake response for call ${calls.length - 1}`);
    if (step.networkError) throw new TypeError("Failed to fetch");
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetcher, calls };
}

const IMG_A = "11111111-1111-4111-8111-111111111111";
const IMG_B = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";
const VIDEO_A = "44444444-4444-4444-8444-444444444444";
const VIDEO_B = "55555555-5555-4555-8555-555555555555";

function serverGallery(overrides: Partial<ServerGallery> = {}): ServerGallery {
  return {
    introMediaId: VID,
    photos: [
      { mediaId: IMG_A, title: "Ibu di dapur", description: "Pagi yang tenang.", memoryDate: "2001-05-02", position: 0 },
    ],
    videos: [
      { mediaId: VIDEO_A, title: "Kenangan", description: "Cerita.", memoryDate: null, position: 0 },
    ],
    ...overrides,
  };
}

function mediaList() {
  return {
    data: [
      { id: IMG_A, name: "dapur.jpg", kind: "image" },
      { id: VID, name: "pembuka.mp4", kind: "video" },
    ],
  };
}

/* --------------------------------------------------------------- resolve */

describe("resolveExperience", () => {
  it("resolves media names and preserves server position order", () => {
    const experience = resolveExperience(
      {
        introMediaId: VID,
        photos: [
          { mediaId: IMG_B, title: "B", description: "kedua", memoryDate: null, position: 1 },
          { mediaId: IMG_A, title: "A", description: "pertama", memoryDate: null, position: 0 },
        ],
        videos: [
          { mediaId: VIDEO_B, title: "Video", description: "Kenangan", memoryDate: null, position: 1 },
          { mediaId: VIDEO_A, title: "Video lain", description: "", memoryDate: null, position: 0 },
        ],
      },
      [
        { id: IMG_A, name: "a.jpg", kind: "image" },
        { id: IMG_B, name: "b.jpg", kind: "image" },
        { id: VID, name: "v.mp4", kind: "video" },
        { id: VIDEO_A, name: "memories.mp4", kind: "video" },
        { id: VIDEO_B, name: "family.mp4", kind: "video" },
      ],
    );
    expect(experience.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    expect(experience.photos[0].name).toBe("a.jpg");
    expect(experience.videos.map((video) => video.mediaId)).toEqual([VIDEO_A, VIDEO_B]);
    expect(experience.videos[0].name).toBe("memories.mp4");
    expect(experience.intro).toEqual({ mediaId: VID, name: "v.mp4" });
  });

  it("falls back on names when media metadata is missing and intro is null when unset", () => {
    const experience = resolveExperience(
      {
        introMediaId: null,
        photos: [{ mediaId: IMG_A, title: "A", description: "", memoryDate: null, position: 0 }],
        videos: [],
      },
      [],
    );
    expect(experience.intro).toBeNull();
    expect(experience.photos[0].name).toBe("Foto");
    expect(experience.videos).toEqual([]);
  });
});

/* ----------------------------------------------------------- phase model */

describe("phase model", () => {
  const withIntro: Experience = { intro: { mediaId: VID, name: "v" }, photos: [], videos: [] };
  const withoutIntro: Experience = { intro: null, photos: [], videos: [] };

  it("starts in intro when a video exists, else gallery", () => {
    expect(initialPhase(withIntro)).toBe("intro");
    expect(initialPhase(withoutIntro)).toBe("gallery");
  });

  it("advances to gallery on real events and never returns to intro", () => {
    for (const event of ["ended", "skip", "intro-error", "no-intro"] as const) {
      expect(nextPhase("intro", event)).toBe("gallery");
    }
    expect(nextPhase("gallery", "ended")).toBe("gallery");
    expect(nextPhase("gallery", "skip")).toBe("gallery");
  });
});

/* ------------------------------------------------------------- load */

describe("loadExperience", () => {
  it("loads gallery + media and resolves the model", async () => {
    const { fetcher, calls } = fakeFetcher([
      { status: 200, body: { data: serverGallery() } },
      { status: 200, body: mediaList() },
    ]);
    const result = await loadExperience(fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.experience.intro?.mediaId).toBe(VID);
      expect(result.experience.photos[0].title).toBe("Ibu di dapur");
      expect(result.experience.photos[0].memoryDate).toBe("2001-05-02");
    }
    expect(calls[0].url).toBe("/api/archive/gallery");
    expect(calls[1].url).toBe("/api/media");
  });

  it("stays ok with fallback names when the media list cannot be loaded", async () => {
    const { fetcher } = fakeFetcher([
      { status: 200, body: { data: serverGallery() } },
      { status: 500 },
    ]);
    const result = await loadExperience(fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.experience.photos[0].name).toBe("Foto");
    }
  });

  it("maps 503 to not_migrated (never empty)", async () => {
    const { fetcher } = fakeFetcher([
      { status: 503, body: { error: { code: "GALLERY_NOT_MIGRATED" } } },
      { status: 200, body: { data: [] } },
    ]);
    expect((await loadExperience(fetcher)).status).toBe("not_migrated");
  });

  it("maps 401/403 to unauthorized", async () => {
    const unauth = fakeFetcher([{ status: 401 }, { status: 401 }]);
    expect((await loadExperience(unauth.fetcher)).status).toBe("unauthorized");
    const forbidden = fakeFetcher([{ status: 403 }, { status: 403 }]);
    expect((await loadExperience(forbidden.fetcher)).status).toBe("unauthorized");
  });

  it("maps network failure to unavailable", async () => {
    const { fetcher } = fakeFetcher([
      { status: 0, networkError: true },
      { status: 0, networkError: true },
    ]);
    expect((await loadExperience(fetcher)).status).toBe("unavailable");
  });
});

describe("experienceNote", () => {
  it("explains non-ok states honestly", () => {
    expect(experienceNote("not_migrated").message).toContain("bukan galeri kosong");
    expect(experienceNote("unauthorized").message).toContain("admin");
    expect(experienceNote("unavailable").title).toBe("Gagal memuat arsip");
  });
});
