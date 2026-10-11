import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { GET as listGet, POST as createPost } from "@/app/api/birthday/letters/route";
import { GET as byAgeGet } from "@/app/api/birthday/letters/[age]/route";

const BASE = "https://vanka.test";
const OWNER_ID = "admin-owner";
const EDITOR_ID = "admin-editor";
const EDITION_ID = "22222222-2222-4222-8222-222222222222";

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

function letterRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    edition_id: EDITION_ID,
    year: 2026,
    title: "Selamat ulang tahun",
    display_date: "27 Oktober 2026",
    full_text: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: null,
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
    editionId?: string | null;
    savedRow?: ReturnType<typeof letterRow> | null;
    list?: Array<ReturnType<typeof letterRow>>;
    byYear?: ReturnType<typeof letterRow> | null;
  } = {},
) {
  // Register the generic session UPDATE FIRST so the more specific
  // "WITH renewed AS" handler (registered after) wins for the CTE lookup.
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("SELECT id FROM birthday_editions", () => ({
    rows: opts.editionId ? [{ id: opts.editionId }] : [],
    rowCount: opts.editionId ? 1 : 0,
  }));
  fake.when("INSERT INTO birthday_letters", () => ({
    rows: opts.savedRow ? [opts.savedRow] : [],
    rowCount: opts.savedRow ? 1 : 0,
  }));
  fake.when("ORDER BY e.year", () => ({ rows: opts.list ?? [], rowCount: opts.list?.length ?? 0 }));
  fake.when("WHERE e.year = $1", () => ({
    rows: opts.byYear ? [opts.byYear] : [],
    rowCount: opts.byYear ? 1 : 0,
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
    age: 1,
    title: "Selamat ulang tahun",
    displayDate: "27 Oktober 2026",
    fullText: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: null,
    ...overrides,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function insertCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO birthday_letters"),
  );
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("GET /api/birthday/letters", () => {
  it("requires an admin session (401 when missing)", async () => {
    setupDb(fake, { admin: null });
    const res = await listGet(new Request(`${BASE}/api/birthday/letters`));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("denies an editor (403)", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await listGet(
      new Request(`${BASE}/api/birthday/letters`, { headers: { cookie: sessionCookie("editor") } }),
    );
    expect(res.status).toBe(403);
    expect((await json(res)).error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns the letters for an operator", async () => {
    setupDb(fake, { admin: adminRow("owner"), list: [letterRow()] });
    const res = await listGet(
      new Request(`${BASE}/api/birthday/letters`, { headers: { cookie: sessionCookie("owner") } }),
    );
    expect(res.status).toBe(200);
    const payload = (await json(res)) as { data: Array<{ year: number; status: string }> };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]).toMatchObject({ year: 2026, status: "draft" });
  });
});

describe("POST /api/birthday/letters", () => {
  it("rejects a cross-site/unsafe mutation (403, no CSRF header)", async () => {
    setupDb(fake, { admin: adminRow("owner"), editionId: EDITION_ID });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, { method: "POST", body: body() }),
    );
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("denies an editor (403) before touching the database", async () => {
    setupDb(fake, { admin: adminRow("editor"), editionId: EDITION_ID });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("editor")),
        body: body(),
      }),
    );
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("rejects an unknown status key (422) and never inserts", async () => {
    setupDb(fake, { admin: adminRow("owner"), editionId: EDITION_ID });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ status: "published" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("rejects an out-of-registry age (422) before any edition lookup", async () => {
    setupDb(fake, { admin: adminRow("owner"), editionId: EDITION_ID });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body({ age: 99 }),
      }),
    );
    expect(res.status).toBe(422);
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("SELECT id FROM birthday_editions")),
    ).toBe(false);
  });

  it("refuses when the edition does not exist (409) and never fabricates it", async () => {
    setupDb(fake, { admin: adminRow("owner"), editionId: null });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "EDITION_NOT_FOUND" });
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("refuses to overwrite a non-draft letter (409 LETTER_LOCKED)", async () => {
    setupDb(fake, { admin: adminRow("owner"), editionId: EDITION_ID, savedRow: null });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "LETTER_LOCKED" });
  });

  it("saves a draft: status is hardcoded to 'draft' and never a client value", async () => {
    const saved = letterRow();
    setupDb(fake, { admin: adminRow("owner"), editionId: EDITION_ID, savedRow: saved });
    const res = await createPost(
      new Request(`${BASE}/api/birthday/letters`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: body(),
      }),
    );
    expect(res.status).toBe(200);

    const calls = insertCalls(fake);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(String(sql)).toContain("'draft'");
    expect(String(sql)).toContain("ON CONFLICT (edition_id)");
    expect(String(sql)).toContain("WHERE birthday_letters.status = 'draft'");
    // Parameters are exactly: edition, title, date, text, sections, thumbnail, admin.
    expect((params as unknown[])[0]).toBe(EDITION_ID);
    expect((params as unknown[])[6]).toBe(OWNER_ID);
    expect((params as unknown[]).some((p) => p === "published")).toBe(false);
  });
});

describe("GET /api/birthday/letters/[age]", () => {
  it("400 on a non-registry age", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await byAgeGet(
      new Request(`${BASE}/api/birthday/letters/99`, { headers: { cookie: sessionCookie("owner") } }),
      { params: Promise.resolve({ age: "99" }) },
    );
    expect(res.status).toBe(400);
  });

  it("404 when no letter exists for the edition", async () => {
    setupDb(fake, { admin: adminRow("owner"), byYear: null });
    const res = await byAgeGet(
      new Request(`${BASE}/api/birthday/letters/1`, { headers: { cookie: sessionCookie("owner") } }),
      { params: Promise.resolve({ age: "1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns the letter for the edition age", async () => {
    setupDb(fake, { admin: adminRow("owner"), byYear: letterRow() });
    const res = await byAgeGet(
      new Request(`${BASE}/api/birthday/letters/1`, { headers: { cookie: sessionCookie("owner") } }),
      { params: Promise.resolve({ age: "1" }) },
    );
    expect(res.status).toBe(200);
    const payload = (await json(res)) as { data: { year: number } };
    expect(payload.data.year).toBe(2026);
  });
});
