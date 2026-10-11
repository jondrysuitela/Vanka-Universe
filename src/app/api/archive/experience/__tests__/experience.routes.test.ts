import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

const h = vi.hoisted(() => ({
  files: new Map<string, { record: Record<string, unknown>; data: Buffer }>(),
  readCalls: [] as string[],
}));

vi.mock("@/lib/media/store", () => ({
  MAX_REQUEST_BYTES: 4096,
  listMedia: vi.fn(),
  saveMediaUpload: vi.fn(),
  readMediaFile: (id: string) => {
    h.readCalls.push(id);
    return h.files.get(id) ?? null;
  },
  findMediaRecord: vi.fn(() => null),
  updateMediaMetadata: vi.fn(),
  deleteMedia: vi.fn(),
}));

vi.mock("@/lib/media/references", () => ({
  checkMediaReferences: vi.fn(),
  registerMediaReferenceProbe: vi.fn(),
}));

import { GET as experienceGet } from "@/app/api/archive/experience/route";
import { GET as experienceMediaGet } from "@/app/api/archive/experience/media/[id]/route";
import { GET as galleryGet } from "@/app/api/archive/gallery/route";
import { GET as mediaGet } from "@/app/api/media/route";

const BASE = "https://vanka.test";
const VISITOR_COOKIE = "vanka_archive_access=visitor-token";

const IMG_A = "11111111-1111-4111-8111-111111111111";
const IMG_B = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";

type Fake = ReturnType<typeof createFakePool>;

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function errorCode(payload: Record<string, unknown>): string | undefined {
  const error = payload.error as { code?: string } | undefined;
  return error?.code;
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const archiveRow = {
  id: "a1",
  slug: "tentang-ibumu",
  title: "Tentang Ibumu",
  narrative: "Cerita panjang.",
  music_enabled: true,
  music_media_id: null,
  status: "draft",
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function setupArchive(fake: Fake, opts: { row?: typeof archiveRow | null } = {}) {
  const row = opts.row === undefined ? archiveRow : opts.row;
  fake.when("FROM private_archives WHERE slug", () => ({
    rows: row ? [row] : [],
    rowCount: row ? 1 : 0,
  }));
}

/** Gallery with an intro video and one photo. */
function setupGallery(fake: Fake, opts: { migrated?: boolean; empty?: boolean } = {}) {
  if (opts.migrated === false) {
    fake.when("FROM private_archive_media", () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    return;
  }
  const rows = opts.empty
    ? []
    : [
        { media_id: VID, role: "intro", title: "", description: "", memory_date: null, position: 0 },
        { media_id: IMG_A, role: "photo", title: "A", description: "Cerita", memory_date: null, position: 0 },
      ];
  fake.when("FROM private_archive_media", () => ({ rows, rowCount: rows.length }));
}

function setupSession(fake: Fake, valid = true) {
  fake.when("FROM archive_access_sessions s", () =>
    valid ? { rows: [{ id: "s1" }], rowCount: 1 } : { rows: [], rowCount: 0 },
  );
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  h.files.clear();
  h.readCalls.length = 0;
});

describe("GET /api/archive/experience", () => {
  it("requires a visitor session (401) with no query for a missing cookie", async () => {
    const res = await experienceGet(new Request(`${BASE}/api/archive/experience`));
    expect(res.status).toBe(401);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("does not accept the admin session cookie", async () => {
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: "vanka_session=admin" } }),
    );
    expect(res.status).toBe(401);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects an invalid/expired/revoked visitor token (401)", async () => {
    setupSession(fake, false);
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(401);
  });

  it("returns title, narrative, music status, intro and photos, with no internals", async () => {
    setupSession(fake);
    setupArchive(fake);
    setupGallery(fake);
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(200);
    const payload = await json(res);
    const data = payload.data as Record<string, unknown>;
    expect(data.title).toBe("Tentang Ibumu");
    expect(data.narrative).toBe("Cerita panjang.");
    expect(data.musicEnabled).toBe(true);
    expect(data.introMediaId).toBe(VID);
    expect((data.photos as Array<{ mediaId: string }>).map((p) => p.mediaId)).toEqual([IMG_A]);

    // No storage internals, audio URL, or music id leak.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("storageKey");
    expect(text).not.toContain("signed");
    expect(text).not.toContain("url");
    expect(data).not.toHaveProperty("musicMediaId");
  });

  it("returns an honest empty view when there is no archive row and no content", async () => {
    setupSession(fake);
    setupArchive(fake, { row: null });
    setupGallery(fake, { empty: true });
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(200);
    const data = (await json(res)).data as Record<string, unknown>;
    expect(data).toEqual({
      title: "",
      narrative: "",
      musicEnabled: false,
      introMediaId: null,
      photos: [],
    });
  });

  it("fails closed (503) when the gallery table is not migrated", async () => {
    setupSession(fake);
    setupArchive(fake);
    setupGallery(fake, { migrated: false });
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(503);
    expect(errorCode(await json(res))).toBe("GALLERY_NOT_MIGRATED");
  });

  it("fails closed (503) when the archive schema is missing (4g27 not applied)", async () => {
    setupSession(fake);
    fake.when("FROM private_archives WHERE slug", () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    setupGallery(fake);
    const res = await experienceGet(
      new Request(`${BASE}/api/archive/experience`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(503);
    expect(errorCode(await json(res))).toBe("ARCHIVE_ACCESS_UNAVAILABLE");
  });
});

describe("GET /api/archive/experience/media/[id]", () => {
  it("requires a visitor session (401)", async () => {
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/${IMG_A}`),
      ctx(IMG_A),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an id that is not referenced by the archive (404, no read)", async () => {
    setupSession(fake);
    setupGallery(fake);
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/${IMG_B}`, {
        headers: { cookie: VISITOR_COOKIE },
      }),
      ctx(IMG_B),
    );
    expect(res.status).toBe(404);
    expect(h.readCalls).toHaveLength(0);
  });

  it("rejects a non-UUID id (400)", async () => {
    setupSession(fake);
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/not-a-uuid`, {
        headers: { cookie: VISITOR_COOKIE },
      }),
      ctx("not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("streams an allowlisted media with its MIME (200)", async () => {
    setupSession(fake);
    setupGallery(fake);
    h.files.set(IMG_A, {
      record: { id: IMG_A, name: "a.jpg", mime: "image/jpeg", kind: "image", size: 5 },
      data: Buffer.from("hello"),
    });
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/${IMG_A}`, {
        headers: { cookie: VISITOR_COOKIE },
      }),
      ctx(IMG_A),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("hello");
  });

  it("honours a Range request (206 with Content-Range)", async () => {
    setupSession(fake);
    setupGallery(fake);
    h.files.set(VID, {
      record: { id: VID, name: "v.mp4", mime: "video/mp4", kind: "video", size: 5 },
      data: Buffer.from("hello"),
    });
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/${VID}`, {
        headers: { cookie: VISITOR_COOKIE, range: "bytes=0-1" },
      }),
      ctx(VID),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-1/5");
    expect(res.headers.get("Content-Length")).toBe("2");
    expect(await res.text()).toBe("he");
  });

  it("fails closed (503) when the gallery table is not migrated", async () => {
    setupSession(fake);
    setupGallery(fake, { migrated: false });
    const res = await experienceMediaGet(
      new Request(`${BASE}/api/archive/experience/media/${IMG_A}`, {
        headers: { cookie: VISITOR_COOKIE },
      }),
      ctx(IMG_A),
    );
    expect(res.status).toBe(503);
    expect(errorCode(await json(res))).toBe("GALLERY_NOT_MIGRATED");
  });
});

describe("visitor cookie cannot reach admin archive/media APIs", () => {
  it("GET /api/archive/gallery denies a visitor-only cookie (401)", async () => {
    fake.when("WITH renewed AS", () => ({ rows: [], rowCount: 0 }));
    const res = await galleryGet(
      new Request(`${BASE}/api/archive/gallery`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/media denies a visitor-only cookie (401)", async () => {
    fake.when("WITH renewed AS", () => ({ rows: [], rowCount: 0 }));
    const res = await mediaGet(
      new Request(`${BASE}/api/media`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(401);
  });
});
