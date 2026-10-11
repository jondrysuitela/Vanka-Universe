import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { POST as createEdition } from "@/app/api/birthday/editions/route";

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

function editionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    year: 2026,
    title: "Vanka's First Universe",
    subtitle: "Semesta pertama Vanka",
    narrative: null,
    cover_media_id: null,
    status: "draft",
    scheduled_at: null,
    published_at: null,
    privacy: "private",
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
    insertedRow?: ReturnType<typeof editionRow> | null;
    insertError?: unknown;
  } = {},
) {
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("INSERT INTO birthday_editions", () => {
    if (opts.insertError) return Promise.reject(opts.insertError);
    return {
      rows: opts.insertedRow ? [opts.insertedRow] : [],
      rowCount: opts.insertedRow ? 1 : 0,
    };
  });
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

function post(body: unknown, headers: Headers): Promise<Response> {
  return createEdition(
    new Request(`${BASE}/api/birthday/editions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function insertCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO birthday_editions"),
  );
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("POST /api/birthday/editions — authorization & protection", () => {
  it("401 when no session", async () => {
    setupDb(fake, { admin: null });
    const res = await post({ age: 1 }, mutationHeaders());
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatchObject({ code: "UNAUTHORIZED" });
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("403 for an editor before any write", async () => {
    setupDb(fake, { admin: adminRow("editor") });
    const res = await post({ age: 1 }, mutationHeaders(sessionCookie("editor")));
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("403 without CSRF/origin headers", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await post({ age: 1 }, new Headers());
    expect(res.status).toBe(403);
    expect(insertCalls(fake)).toHaveLength(0);
  });
});

describe("POST /api/birthday/editions — validation", () => {
  it("422 for an unregistered age", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await post({ age: 99 }, mutationHeaders(sessionCookie("owner")));
    expect(res.status).toBe(422);
    expect(insertCalls(fake)).toHaveLength(0);
  });

  it("422 when the client supplies a server-derived field", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    for (const forbidden of [{ title: "Hacked" }, { status: "published" }, { year: 2026 }]) {
      const res = await post({ age: 1, ...forbidden }, mutationHeaders(sessionCookie("owner")));
      expect(res.status, JSON.stringify(forbidden)).toBe(422);
    }
    expect(insertCalls(fake)).toHaveLength(0);
  });
});

describe("POST /api/birthday/editions — creation", () => {
  it("creates a draft edition with server-derived fields", async () => {
    setupDb(fake, { admin: adminRow("owner"), insertedRow: editionRow() });
    const res = await post({ age: 1 }, mutationHeaders(sessionCookie("owner")));
    expect(res.status).toBe(201);

    const calls = insertCalls(fake);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(String(sql)).toContain("'draft'");
    expect(String(sql)).toContain("'private'");
    expect(String(sql)).toContain("ON CONFLICT (year) DO NOTHING");
    // year/title/subtitle from the registry, created_by from the session.
    expect(params).toEqual([2026, "Vanka's First Universe", "Semesta pertama Vanka", OWNER_ID]);
    expect((params as unknown[]).some((p) => p === "published")).toBe(false);
  });

  it("409 when an edition for that year already exists (never overwritten)", async () => {
    setupDb(fake, { admin: adminRow("owner"), insertedRow: null });
    const res = await post({ age: 1 }, mutationHeaders(sessionCookie("owner")));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "EDITION_EXISTS" });
  });

  it("500 on a database error without leaking connection details", async () => {
    setupDb(fake, {
      admin: adminRow("owner"),
      insertError: new Error("connect ECONNREFUSED 127.0.0.1:5432 (postgres://user:secret@host)"),
    });
    const res = await post({ age: 1 }, mutationHeaders(sessionCookie("owner")));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await json(res));
    expect(text).toContain("INTERNAL_ERROR");
    for (const leak of ["ECONNREFUSED", "5432", "postgres://", "secret"]) {
      expect(text).not.toContain(leak);
    }
  });
});
