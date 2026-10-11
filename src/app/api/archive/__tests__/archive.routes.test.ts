import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { GET as archiveGet, PUT as archivePut } from "@/app/api/archive/route";

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

function archiveRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "tentang-ibumu",
    title: "Tentang Ibumu",
    narrative: "Paragraf.",
    music_enabled: false,
    music_media_id: null,
    status: "draft",
    created_by: OWNER_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setupDb(
  fake: Fake,
  opts: {
    admin?: ReturnType<typeof adminRow> | null;
    row?: ReturnType<typeof archiveRow> | null;
    savedRow?: ReturnType<typeof archiveRow> | null;
  } = {},
) {
  // Generic session UPDATE first; the specific CTE handler after wins lookup.
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("INSERT INTO private_archives", () => ({
    rows: opts.savedRow ? [opts.savedRow] : [],
    rowCount: opts.savedRow ? 1 : 0,
  }));
  fake.when("FROM private_archives", () => ({
    rows: opts.row ? [opts.row] : [],
    rowCount: opts.row ? 1 : 0,
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
    title: "Tentang Ibumu",
    narrative: "Paragraf.",
    musicEnabled: false,
    musicMediaId: null,
    ...overrides,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function insertCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO private_archives"));
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("GET /api/archive", () => {
  it("requires an admin session (401)", async () => {
    setupDb(fake, { admin: null });
    const res = await archiveGet(new Request(`${BASE}/api/archive`));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("denies an editor (403)", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await archiveGet(
      new Request(`${BASE}/api/archive`, { headers: { cookie: sessionCookie("editor") } }),
    );
    expect(res.status).toBe(403);
  });

  it("returns null data when no archive exists yet", async () => {
    setupDb(fake, { admin: adminRow("owner"), row: null });
    const res = await archiveGet(
      new Request(`${BASE}/api/archive`, { headers: { cookie: sessionCookie("owner") } }),
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ data: null });
  });

  it("returns the private archive for an operator", async () => {
    setupDb(fake, { admin: adminRow("admin"), row: archiveRow() });
    const res = await archiveGet(
      new Request(`${BASE}/api/archive`, { headers: { cookie: sessionCookie("admin") } }),
    );
    expect(res.status).toBe(200);
    const payload = (await json(res)) as { data: { slug: string; status: string } };
    expect(payload.data).toMatchObject({ slug: "tentang-ibumu", status: "draft" });
  });
});

describe("PUT /api/archive", () => {
  it("rejects an unsafe mutation (403, no CSRF header)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await archivePut(
      new Request(`${BASE}/api/archive`, { method: "PUT", body: body() }),
    );
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("denies an editor (403) before any write", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await archivePut(
      new Request(`${BASE}/api/archive`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("editor")),
        body: body(),
      }),
    );
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("rejects a raw path/URL (musicSrc) as a media reference (422)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await archivePut(
      new Request(`${BASE}/api/archive`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ musicSrc: "/audio/music.mp3" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("rejects client-supplied privacy/status (422)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    for (const forbidden of [{ privacy: "public" }, { status: "archived" }]) {
      const res = await archivePut(
        new Request(`${BASE}/api/archive`, {
          method: "PUT",
          headers: mutationHeaders(sessionCookie("owner")),
          body: body(forbidden),
        }),
      );
      expect(res.status, JSON.stringify(forbidden)).toBe(422);
    }
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("fail-closed: rejects a non-null music_media_id (422 AUDIO_NOT_SUPPORTED)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await archivePut(
      new Request(`${BASE}/api/archive`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ musicMediaId: "11111111-1111-4111-8111-111111111111", musicEnabled: true }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "AUDIO_NOT_SUPPORTED" });
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("saves the private archive: status hardcoded 'draft', slug is a parameter", async () => {
    setupDb(fake, { admin: adminRow("owner"), savedRow: archiveRow({ music_enabled: true }) });
    const res = await archivePut(
      new Request(`${BASE}/api/archive`, {
        method: "PUT",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ musicEnabled: true }),
      }),
    );
    expect(res.status).toBe(200);

    const calls = insertCalls(fake);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(String(sql)).toContain("'draft'");
    expect(String(sql)).toContain("ON CONFLICT (slug)");
    expect(String(sql)).not.toContain("musicSrc");
    expect((params as unknown[])[0]).toBe("tentang-ibumu");
    expect((params as unknown[])[4]).toBeNull();
    expect((params as unknown[])[5]).toBe(OWNER_ID);
  });
});
