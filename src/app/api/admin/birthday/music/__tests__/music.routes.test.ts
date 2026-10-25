import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

// The media lookup is exercised through its own suite; here it only needs to
// answer "this id exists and is audio" or "it does not".
const findMediaRecord = vi.fn();
vi.mock("@/lib/media/store", () => ({
  findMediaRecord: (id: string) => findMediaRecord(id),
}));

import { GET, PATCH, PUT, DELETE } from "@/app/api/admin/birthday/music/route";

/**
 * Per-edition background music (admin side).
 *
 * The point of these tests is the WRITE path's guard rails: who may write, that
 * a bad or non-audio file never reaches the table, and that attaching a song
 * does not silently publish it.
 */

const BASE = "https://vanka.test";
const OWNER_ID = "admin-owner";
const EDITOR_ID = "admin-editor";

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

function musicRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    year: 2026,
    media_id: "11111111-1111-4111-8111-111111111111",
    display_name: "lagu.mp3",
    volume: null,
    published_at: null,
    updated_at: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

function setupDb(
  fake: Fake,
  opts: { admin?: ReturnType<typeof adminRow> | null; row?: ReturnType<typeof musicRow> | null } = {},
) {
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("FROM birthday_editions WHERE year", () => ({
    rows: opts.row === null ? [] : [{ id: "edition-1" }],
    rowCount: opts.row === null ? 0 : 1,
  }));
  fake.when("INSERT INTO birthday_music", () => ({
    rows: opts.row ? [opts.row] : [],
    rowCount: opts.row ? 1 : 0,
  }));
}

function headers(role?: "owner" | "admin" | "editor", extra = true): Headers {
  const h = new Headers();
  h.set("origin", BASE);
  h.set("content-type", "application/json");
  if (extra) h.set("x-vanka-request", "1");
  if (role) h.set("cookie", `vanka_session=token-${role}`);
  return h;
}

function put(body: unknown, h: Headers): Promise<Response> {
  return PUT(new Request(`${BASE}/api/admin/birthday/music`, { method: "PUT", headers: h, body: JSON.stringify(body) }));
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  const fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  findMediaRecord.mockReset();
  findMediaRecord.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    mime: "audio/mpeg",
    kind: "audio",
    collection: "music",
  });
});

describe("authorization", () => {
  it("denies an anonymous request", async () => {
    setupDb(createFakePool(), { admin: null });
    const res = await put({ year: 2026, mediaId: null }, headers(undefined));
    expect(res.status).toBe(401);
  });

  it("denies an editor — only owner/admin may change music", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("editor") });
    const res = await put({ year: 2026, mediaId: null }, headers("editor"));
    expect(res.status).toBe(403);
  });

  it("requires the CSRF custom header on writes", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    const res = await put({ year: 2026, mediaId: null }, headers("owner", false));
    expect(res.status).toBe(403);
  });
});

describe("validation", () => {
  it("rejects a year outside the registry", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    const res = await put({ year: 1999, mediaId: null }, headers("owner"));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toMatchObject({ code: "INVALID_YEAR" });
  });

  it("rejects a media id that does not exist", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    findMediaRecord.mockResolvedValue(null);
    const res = await put(
      { year: 2026, mediaId: "99999999-9999-4999-8999-999999999999" },
      headers("owner"),
    );
    expect(res.status).toBe(404);
    expect((await body(res)).error).toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });

  it("rejects an image used as a song", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    findMediaRecord.mockResolvedValue({ id: "x", mime: "image/jpeg", kind: "image" });
    const res = await put({ year: 2026, mediaId: "x" }, headers("owner"));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toMatchObject({ code: "NOT_AUDIO" });
  });

  it("rejects audio that was not uploaded into the music pool", async () => {
    // An audio file sitting in the birthday pool would be counted by the
    // gallery query and by the player at the same time.
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    findMediaRecord.mockResolvedValue({
      id: "x",
      mime: "audio/mpeg",
      kind: "audio",
      collection: "birthday",
    });
    const res = await put({ year: 2026, mediaId: "x" }, headers("owner"));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toMatchObject({ code: "WRONG_COLLECTION" });
  });

  it("explains when the edition itself does not exist yet", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner"), row: null });
    const res = await put({ year: 2026, mediaId: null }, headers("owner"));
    expect(res.status).toBe(404);
    expect((await body(res)).error).toMatchObject({ code: "EDITION_NOT_FOUND" });
  });
});

describe("publishing", () => {
  it("attaches a song WITHOUT publishing it by default", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner"), row: musicRow() });

    const res = await put(
      { year: 2026, mediaId: "11111111-1111-4111-8111-111111111111", displayName: "lagu.mp3" },
      headers("owner"),
    );
    expect(res.status).toBe(200);

    // The published_at parameter must be NULL: an upload never goes live alone.
    const insert = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO birthday_music"));
    expect(insert).toBeDefined();
    const params = insert?.[1] as unknown[];
    expect(params[4]).toBeNull();
  });

  it("publishes only when explicitly asked", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, {
      admin: adminRow("owner"),
      row: musicRow({ published_at: "2026-10-24T00:00:00.000Z" }),
    });

    const res = await put(
      { year: 2026, mediaId: "11111111-1111-4111-8111-111111111111", publish: true },
      headers("owner"),
    );
    expect(res.status).toBe(200);

    const insert = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO birthday_music"));
    const params = insert?.[1] as unknown[];
    expect(params[4]).toBeInstanceOf(Date);
  });
});

describe("PATCH / DELETE", () => {
  it("PATCH requires an explicit boolean publish flag", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    const res = await PATCH(
      new Request(`${BASE}/api/admin/birthday/music`, {
        method: "PATCH",
        headers: headers("owner"),
        body: JSON.stringify({ year: 2026 }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("DELETE reports 404 when the edition has no song", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    setupDb(fake, { admin: adminRow("owner") });
    fake.when("DELETE FROM birthday_music", () => ({ rows: [], rowCount: 0 }));

    const res = await DELETE(
      new Request(`${BASE}/api/admin/birthday/music?year=2026`, {
        method: "DELETE",
        headers: headers("owner"),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET", () => {
  it("returns the admin list", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    fake.when("UPDATE sessions", ok);
    fake.when("WITH renewed AS", () => ({ rows: [adminRow("owner")], rowCount: 1 }));
    fake.when("FROM birthday_music m", () => ({ rows: [musicRow()], rowCount: 1 }));

    const res = await GET(
      new Request(`${BASE}/api/admin/birthday/music`, { headers: headers("owner") }),
    );
    expect(res.status).toBe(200);
    const payload = (await body(res)).data as { music: Array<{ year: number; age: number }> };
    expect(payload.music[0]).toMatchObject({ year: 2026, age: 1 });
  });
});
