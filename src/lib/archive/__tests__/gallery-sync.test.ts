import { describe, expect, it } from "vitest";

import {
  GALLERY_URL,
  MEDIA_URL,
  addPhoto,
  fromServerGallery,
  galleryLoadNote,
  gallerySaveMessage,
  galleryStatesEqual,
  isMediaUsed,
  loadGallery,
  loadMediaFiles,
  movePhoto,
  removePhoto,
  saveGallery,
  setIntro,
  splitMedia,
  toGalleryBody,
  updatePhoto,
  type FetchLike,
  type GalleryState,
  type MediaFile,
  type ServerGallery,
} from "@/lib/archive/gallery-sync";

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

function file(id: string, kind: "image" | "video", name = "x"): MediaFile {
  return { id, name, kind };
}

function serverGallery(overrides: Partial<ServerGallery> = {}): ServerGallery {
  return {
    introMediaId: VID,
    photos: [{ mediaId: IMG_A, title: "A", description: "Cerita", memoryDate: null, position: 0 }],
    ...overrides,
  };
}

function state(overrides: Partial<GalleryState> = {}): GalleryState {
  return {
    introMediaId: null,
    photos: [{ mediaId: IMG_A, title: "A", description: "Cerita", memoryDate: null }],
    ...overrides,
  };
}

/* ---------------------------------------------------------------- media */

describe("loadMediaFiles", () => {
  it("keeps only well-formed image/video records", async () => {
    const { fetcher } = fakeFetcher([
      {
        status: 200,
        body: {
          data: [
            { id: IMG_A, name: "a.jpg", kind: "image", mime: "image/jpeg" },
            { id: VID, name: "v.mp4", kind: "video" },
            { id: "bad", name: "b", kind: "audio" },
            { nope: true },
          ],
        },
      },
    ]);
    const result = await loadMediaFiles(fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.files.map((f) => f.id)).toEqual([IMG_A, VID]);
    }
  });

  it("maps 401/403 to unauthorized and network/5xx to unavailable", async () => {
    const unauth = fakeFetcher([{ status: 403 }]);
    expect((await loadMediaFiles(unauth.fetcher)).status).toBe("unauthorized");

    const net = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await loadMediaFiles(net.fetcher)).status).toBe("unavailable");

    const boom = fakeFetcher([{ status: 500 }]);
    expect((await loadMediaFiles(boom.fetcher)).status).toBe("unavailable");
  });

  it("requests the media endpoint", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: [] } }]);
    await loadMediaFiles(fetcher);
    expect(calls[0].url).toBe(MEDIA_URL);
  });
});

describe("splitMedia", () => {
  it("separates videos and images", () => {
    const { videos, images } = splitMedia([file(IMG_A, "image"), file(VID, "video")]);
    expect(videos.map((f) => f.id)).toEqual([VID]);
    expect(images.map((f) => f.id)).toEqual([IMG_A]);
  });
});

/* ------------------------------------------------------------ operations */

describe("pure editor operations", () => {
  it("adds a photo and refuses duplicates", () => {
    const added = addPhoto(state(), IMG_B);
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.state.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    }
    expect(addPhoto(state(), IMG_A)).toEqual({ ok: false, reason: "used" });
  });

  it("removes a photo without touching other entries", () => {
    const next = removePhoto(state({ photos: [
      { mediaId: IMG_A, title: "A", description: "", memoryDate: null },
      { mediaId: IMG_B, title: "B", description: "", memoryDate: null },
    ] }), IMG_A);
    expect(next.photos.map((p) => p.mediaId)).toEqual([IMG_B]);
  });

  it("updates individual metadata", () => {
    const next = updatePhoto(state(), IMG_A, { title: "Ibu", memoryDate: "2026-01-02" });
    expect(next.photos[0]).toMatchObject({ title: "Ibu", memoryDate: "2026-01-02" });
  });

  it("moves photos up/down and clamps at the ends", () => {
    const base = state({
      photos: [
        { mediaId: IMG_A, title: "A", description: "", memoryDate: null },
        { mediaId: IMG_B, title: "B", description: "", memoryDate: null },
      ],
    });
    expect(movePhoto(base, 0, -1).photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    expect(movePhoto(base, 0, 1).photos.map((p) => p.mediaId)).toEqual([IMG_B, IMG_A]);
    expect(movePhoto(base, 1, 1).photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
  });

  it("sets/clears the intro and refuses a photo as intro", () => {
    const set = setIntro(state(), VID);
    expect(set.ok && set.state.introMediaId).toBe(VID);
    expect(setIntro(state(), IMG_A)).toEqual({ ok: false, reason: "used" });
    const cleared = setIntro(state({ introMediaId: VID }), null);
    expect(cleared.ok && cleared.state.introMediaId).toBeNull();
  });

  it("reports media usage", () => {
    const withIntro = state({ introMediaId: VID, photos: [
      { mediaId: IMG_A, title: "", description: "", memoryDate: null },
    ] });
    expect(isMediaUsed(withIntro, VID)).toBe(true);
    expect(isMediaUsed(withIntro, IMG_A)).toBe(true);
    expect(isMediaUsed(withIntro, IMG_B)).toBe(false);
  });
});

describe("transport mapping", () => {
  it("builds the exact PUT body with array-order photos", () => {
    const body = toGalleryBody(state({ introMediaId: VID }));
    expect(body).toEqual({
      introMediaId: VID,
      photos: [{ mediaId: IMG_A, title: "A", description: "Cerita", memoryDate: null }],
    });
  });

  it("maps a server gallery preserving position order", () => {
    const g = fromServerGallery({
      introMediaId: VID,
      photos: [
        { mediaId: IMG_B, title: "B", description: "", memoryDate: null, position: 1 },
        { mediaId: IMG_A, title: "A", description: "", memoryDate: null, position: 0 },
      ],
    });
    expect(g.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    expect(g.introMediaId).toBe(VID);
  });

  it("compares gallery states", () => {
    expect(galleryStatesEqual(state(), state())).toBe(true);
    expect(galleryStatesEqual(state(), state({ introMediaId: VID }))).toBe(false);
    expect(galleryStatesEqual(state(), state({ photos: [] }))).toBe(false);
  });
});

/* ------------------------------------------------------------ load/save */

describe("loadGallery", () => {
  it("returns the gallery on success", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: serverGallery() } }]);
    const result = await loadGallery(fetcher);
    expect(result.status).toBe("ok");
    expect(calls[0].url).toBe(GALLERY_URL);
  });

  it("maps 503 to not_migrated (never empty)", async () => {
    const { fetcher } = fakeFetcher([
      { status: 503, body: { error: { code: "GALLERY_NOT_MIGRATED" } } },
    ]);
    expect((await loadGallery(fetcher)).status).toBe("not_migrated");
  });

  it("maps 401/403 to unauthorized and network to unavailable", async () => {
    expect((await loadGallery(fakeFetcher([{ status: 401 }]).fetcher)).status).toBe("unauthorized");
    expect((await loadGallery(fakeFetcher([{ status: 403 }]).fetcher)).status).toBe("unauthorized");
    expect((await loadGallery(fakeFetcher([{ networkError: true, status: 0 }]).fetcher)).status).toBe(
      "unavailable",
    );
  });

  it("treats a malformed payload as unavailable", async () => {
    const { fetcher } = fakeFetcher([{ status: 200, body: { data: { nope: true } } }]);
    expect((await loadGallery(fetcher)).status).toBe("unavailable");
  });
});

describe("saveGallery", () => {
  it("sends PUT and reports saved only on a valid payload", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: serverGallery() } }]);
    const result = await saveGallery(fetcher, state({ introMediaId: VID }));
    expect(result.status).toBe("saved");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ introMediaId: VID });
  });

  it("does NOT report saved when a 200 payload is invalid", async () => {
    const { fetcher } = fakeFetcher([{ status: 200, body: { data: null } }]);
    expect((await saveGallery(fetcher, state())).status).toBe("unavailable");
  });

  it("maps 503 to not_migrated", async () => {
    const { fetcher } = fakeFetcher([{ status: 503, body: { error: { code: "GALLERY_NOT_MIGRATED" } } }]);
    const result = await saveGallery(fetcher, state());
    expect(result.status).toBe("not_migrated");
    const msg = gallerySaveMessage(result);
    expect(msg.message).toContain("belum diaktifkan");
    expect(msg.type).toBe("error");
  });

  it("maps 401/403 to unauthorized", async () => {
    expect((await saveGallery(fakeFetcher([{ status: 401 }]).fetcher, state())).status).toBe(
      "unauthorized",
    );
    expect((await saveGallery(fakeFetcher([{ status: 403 }]).fetcher, state())).status).toBe(
      "unauthorized",
    );
  });

  it("maps 422 to validation with the server message", async () => {
    const { fetcher } = fakeFetcher([
      { status: 422, body: { error: { code: "PHOTO_NOT_IMAGE", message: "Item galeri harus berupa foto." } } },
    ]);
    const result = await saveGallery(fetcher, state());
    expect(result.status).toBe("validation");
    if (result.status === "validation") {
      expect(result.message).toBe("Item galeri harus berupa foto.");
    }
  });

  it("maps network failure to unavailable", async () => {
    const { fetcher } = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await saveGallery(fetcher, state())).status).toBe("unavailable");
  });
});

describe("messages", () => {
  it("gallerySaveMessage marks only 'saved' as success", () => {
    expect(gallerySaveMessage({ status: "saved", gallery: serverGallery() }).type).toBe("success");
    for (const result of [
      { status: "not_migrated" as const },
      { status: "unauthorized" as const },
      { status: "validation" as const, message: "x" },
      { status: "unavailable" as const },
    ]) {
      expect(gallerySaveMessage(result).type).toBe("error");
    }
  });

  it("galleryLoadNote explains non-ok states", () => {
    expect(galleryLoadNote("not_migrated").message).toContain("bukan galeri kosong");
    expect(galleryLoadNote("unavailable").type).toBe("error");
    expect(galleryLoadNote("unauthorized").type).toBe("error");
  });
});
