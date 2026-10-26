import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

const h = vi.hoisted(() => ({
  records: new Map<string, { kind: "image" | "video" }>(),
}));

vi.mock("@/lib/media/store", () => ({
  findMediaRecord: (id: string) => h.records.get(id) ?? null,
}));

import { GET as galleryGet, PUT as galleryPut } from "@/app/api/archive/gallery/route";

const BASE = "https://vanka.test";
const OWNER_ID = "admin-owner";
const EDITOR_ID = "admin-editor";

const IMG_A = "11111111-1111-4111-8111-111111111111";
const VID = "33333333-3333-4333-8333-333333333333";
const VIDEO_A = "44444444-4444-4444-8444-444444444444";

type Fake = ReturnType<typeof createFakePool>;

const ok = (): FakeResult => ({ rows: [], rowCount: 1 });

function adminRow(role: "owner" | "admin" | "editor") {
  return {
    id: role === "editor" ? EDITOR_ID : OWNER_ID,
    email: `${role}@vanka.test`,
    name: `Admin ${role}`,
    role,
    is_active: true,
    session_id: "sess-1",
  };
}

function setupDb(
  fake: Fake,
  opts: { admin?: ReturnType<typeof adminRow> | null; galleryThrows?: boolean } = {},
) {
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  const notMigrated = () => {
    throw Object.assign(new Error('relation "private_archive_media" does not exist'), {
      code: "42P01",
    });
  };
  if (opts.galleryThrows) {
    fake.when("FROM private_archive_media", notMigrated);
    fake.when("INSERT INTO private_archive_media", notMigrated);
    return;
  }
  fake.when("FROM private_archive_media", () => ({
    rows: [
      { media_id: VID, role: "intro", title: "", description: "", memory_date: null, position: 0 },
      { media_id: IMG_A, role: "photo", title: "A", description: "Cerita", memory_date: null, position: 0 },
    ],
    rowCount: 2,
  }));
  fake.when("INSERT INTO private_archive_media", () => ({
    rows: [
      { media_id: IMG_A, role: "photo", title: "A", description: "Cerita", memory_date: null, position: 0 },
    ],
    rowCount: 1,
  }));
}

function mutationHeaders(cookie?: string): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("content-type", "application/json");
  headers.set("x-vanka-request", "1");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

function sessionCookie(role: "owner" | "admin" | "editor"): string {
  return `vanka_session=token-${role}`;
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    introMediaId: VID,
    photos: [{ mediaId: IMG_A, title: "A", description: "Cerita", memoryDate: null }],
    videos: [],
    ...overrides,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function putCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO private_archive_media"),
  );
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  h.records.clear();
});

describe("GET /api/archive/gallery", () => {
  it("requires an admin session (401)", async () => {
    setupDb(fake, { admin: null });
    const res = await galleryGet(new Request(`${BASE}/api/archive/gallery`));
    expect(res.status).toBe(401);
  });

  it("denies an editor (403)", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await galleryGet(
      new Request(`${BASE}/api/archive/gallery`, { headers: { cookie: sessionCookie("editor") } }),
    );
    expect(res.status).toBe(403);
  });

  it("returns the shaped gallery for an operator", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await galleryGet(
      new Request(`${BASE}/api/archive/gallery`, { headers: { cookie: sessionCookie("owner") } }),
    );
    expect(res.status).toBe(200);
    const payload = (await json(res)) as {
      data: { introMediaId: string; photos: Array<{ mediaId: string }> };
    };
    expect(payload.data.introMediaId).toBe(VID);
    expect(payload.data.photos.map((p) => p.mediaId)).toEqual([IMG_A]);
  });

  it("returns 503 when the gallery table is not migrated", async () => {
    setupDb(fake, { admin: adminRow("owner"), galleryThrows: true });
    const res = await galleryGet(
      new Request(`${BASE}/api/archive/gallery`, { headers: { cookie: sessionCookie("owner") } }),
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatchObject({ code: "GALLERY_NOT_MIGRATED" });
  });
});

describe("PUT /api/archive/gallery", () => {
  it("rejects an unsafe mutation (403, no CSRF header)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, { method: "PUT", body: body() }),
    );
    expect(res.status).toBe(403);
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("denies an editor (403) before any write", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("editor")),
        body: body(),
      }),
    );
    expect(res.status).toBe(403);
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("rejects a raw src/path (422) before any write", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: JSON.stringify({ introMediaId: null, photos: [{ mediaId: IMG_A, src: "/x.jpg" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("rejects an unknown intro media (422 MEDIA_NOT_FOUND)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    h.records.set(IMG_A, { kind: "image" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "MEDIA_NOT_FOUND" });
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("rejects a non-video intro (422 INTRO_NOT_VIDEO)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    h.records.set(VID, { kind: "image" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "INTRO_NOT_VIDEO" });
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("rejects a non-image photo (422 PHOTO_NOT_IMAGE)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    h.records.set(VID, { kind: "video" });
    h.records.set(IMG_A, { kind: "video" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "PHOTO_NOT_IMAGE" });
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("rejects a non-video gallery item (422 GALLERY_VIDEO_NOT_VIDEO)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    h.records.set(VID, { kind: "video" });
    h.records.set(IMG_A, { kind: "image" });
    h.records.set(VIDEO_A, { kind: "image" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ videos: [{ mediaId: VIDEO_A, title: "", description: "" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "GALLERY_VIDEO_NOT_VIDEO" });
    expect(putCalls(fake)).toHaveLength(0);
  });

  it("saves the gallery when media are valid", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    h.records.set(VID, { kind: "video" });
    h.records.set(IMG_A, { kind: "image" });
    h.records.set(VIDEO_A, { kind: "video" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ videos: [{ mediaId: VIDEO_A, title: "Video", description: "Kenangan" }] }),
      }),
    );
    expect(res.status).toBe(200);
    const calls = putCalls(fake);
    expect(calls).toHaveLength(1);
    const params = calls[0][1] as unknown[];
    expect(params[2]).toEqual([VID, IMG_A, VIDEO_A]);
    expect(params[3]).toEqual(["intro", "photo", "video"]);
  });

  it("returns 503 when the gallery table is not migrated", async () => {
    setupDb(fake, { admin: adminRow("owner"), galleryThrows: true });
    h.records.set(VID, { kind: "video" });
    h.records.set(IMG_A, { kind: "image" });
    const res = await galleryPut(
      new Request(`${BASE}/api/archive/gallery`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatchObject({ code: "GALLERY_NOT_MIGRATED" });
  });
});
