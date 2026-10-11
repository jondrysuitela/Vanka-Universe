import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool, type FakeResult, type QueryHandler } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { GET as listGet, POST as createPost } from "@/app/api/memories/route";
import {
  GET as detailGet,
  PATCH as detailPatch,
  DELETE as detailDelete,
} from "@/app/api/memories/[id]/route";

const BASE = "https://vanka.test";
const OWNER_ID = "admin-owner";
const EDITOR_ID = "admin-editor";
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

type Fake = ReturnType<typeof createFakePool>;

const ok = (): FakeResult => ({ rows: [], rowCount: 1 });

function adminRow(role: "owner" | "admin" | "editor", id: string = role === "editor" ? EDITOR_ID : OWNER_ID) {
  return {
    id,
    email: `${id}@vanka.test`,
    name: `Admin ${id}`,
    role,
    is_active: true,
    session_id: "sess-1",
  };
}

function memoryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    title: "Malam Pertama",
    description: null,
    memory_date: "2025-10-27",
    category: "Cinta",
    privacy: "private",
    owner_id: OWNER_ID,
    created_by: OWNER_ID,
    created_at: "2026-01-12T00:00:00.000Z",
    updated_at: "2026-01-12T00:00:00.000Z",
    ...overrides,
  };
}

/** Registers a valid admin session (or none) plus memory-query handlers. */
function setupDb(
  fake: Fake,
  opts: {
    admin?: ReturnType<typeof adminRow> | null;
    total?: number;
    list?: Array<ReturnType<typeof memoryRow>>;
    byId?: ReturnType<typeof memoryRow> | null;
    insertResult?: ReturnType<typeof memoryRow>;
    updateResult?: ReturnType<typeof memoryRow> | null;
    deleteError?: unknown;
  } = {},
) {
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when(/SELECT count\(\*\)::int AS n FROM memories/, () => ({
    rows: [{ n: opts.total ?? 0 }],
    rowCount: 1,
  }));
  fake.when("ORDER BY", () => ({ rows: opts.list ?? [], rowCount: opts.list?.length ?? 0 }));
  fake.when("WHERE id =", () => ({
    rows: opts.byId ? [opts.byId] : [],
    rowCount: opts.byId ? 1 : 0,
  }));
  fake.when("INSERT INTO memories", () => ({
    rows: opts.insertResult ? [opts.insertResult] : [],
    rowCount: opts.insertResult ? 1 : 0,
  }));
  fake.when("UPDATE memories", () => ({
    rows: opts.updateResult ? [opts.updateResult] : [],
    rowCount: opts.updateResult ? 1 : 0,
  }));
  fake.when("DELETE FROM memories", () => {
    if (opts.deleteError) return Promise.reject(opts.deleteError);
    return ok();
  });
  fake.when("INSERT INTO audit_logs", ok);
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

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("GET /api/memories (list)", () => {
  it("requires an admin session (401 when missing)", async () => {
    setupDb(fake, { admin: null });
    const res = await listGet(new Request(`${BASE}/api/memories`));
    expect(res.status).toBe(401);
    expect((await json(res)).error).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("paginates with default page=1 limit=20 and returns meta", async () => {
    setupDb(fake, { admin: adminRow("owner"), total: 42, list: [memoryRow()] });
    const res = await listGet(new Request(`${BASE}/api/memories`, { headers: { cookie: sessionCookie("owner") } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.meta).toEqual({ page: 1, limit: 20, total: 42, totalPages: 3 });
    expect(Array.isArray(body.data)).toBe(true);
    const listCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("SELECT count"));
    expect(listCall?.[1]).toEqual([]);
  });

  it("passes pagination limit/offset and whitelisted sort as parameters", async () => {
    setupDb(fake, { admin: adminRow("owner"), total: 0, list: [] });
    const url = `${BASE}/api/memories?page=3&limit=50&sort=title&order=asc`;
    const res = await listGet(new Request(url, { headers: { cookie: sessionCookie("owner") } }));
    expect(res.status).toBe(200);

    const listSqlCalls = fake.query.mock.calls.filter(([sql]) => String(sql).includes("FROM memories") && String(sql).includes("ORDER BY"));
    expect(listSqlCalls.length).toBe(1);
    const [sql, params] = listSqlCalls[0];
    expect(String(sql)).toContain("ORDER BY title ASC");
    expect(String(sql)).toContain("LIMIT $");
    expect(String(sql)).toContain("OFFSET $");
    expect(params).toContain(50);
    expect(params).toContain(100); // offset = (3-1)*50
  });

  it("rejects invalid pagination and non-whitelisted sort (422)", async () => {
    setupDb(fake, { admin: adminRow("owner"), total: 0, list: [] });
    for (const query of ["page=0", "limit=0", "limit=101", "sort=id;DROP", "sort=password", "order=sideways", "page=abc"]) {
      const res = await listGet(
        new Request(`${BASE}/api/memories?${query}`, { headers: { cookie: sessionCookie("owner") } }),
      );
      expect(res.status, query).toBe(422);
    }
  });

  it("validates date filters", async () => {
    setupDb(fake, { admin: adminRow("owner"), total: 0, list: [] });
    const res = await listGet(
      new Request(`${BASE}/api/memories?date_from=2026-13-01`, { headers: { cookie: sessionCookie("owner") } }),
    );
    expect(res.status).toBe(422);
  });

  it("applies filters as parameters (no SQL interpolation)", async () => {
    setupDb(fake, { admin: adminRow("owner"), total: 3, list: [memoryRow()] });
    const res = await listGet(
      new Request(
        `${BASE}/api/memories?privacy=shared&category=Cinta&query=liburan%20pantai&date_from=2026-01-01&date_to=2026-12-31`,
        { headers: { cookie: sessionCookie("owner") } },
      ),
    );
    expect(res.status).toBe(200);

    const filterSql = fake.query.mock.calls.find(([sql]) => String(sql).includes("FROM memories"));
    const sqlText = String(filterSql?.[0] ?? "");
    const params = filterSql?.[1] ?? [];
    expect(sqlText).toContain("privacy = $1");
    expect(sqlText).toContain("category = $2");
    expect(sqlText).toContain("ILIKE $3");
    expect(sqlText).toContain("memory_date >= $4");
    expect(sqlText).toContain("memory_date <= $5");
    expect(params).toEqual(["shared", "Cinta", "%liburan pantai%", "2026-01-01", "2026-12-31"]);
  });

  it("does not leak owner/editor scope or SQL when query contains injection text", async () => {
    setupDb(fake, { admin: adminRow("editor"), total: 0, list: [] });
    const res = await listGet(
      new Request(`${BASE}/api/memories?query=x';%20DROP%20TABLE%20memories;--`, {
        headers: { cookie: sessionCookie("editor") },
      }),
    );
    expect(res.status).toBe(200);

    const allSql = fake.query.mock.calls.map(([sql]) => String(sql));
    for (const sql of allSql) {
      expect(sql).not.toContain("DROP TABLE");
      expect(sql).not.toContain("';");
      expect(sql).not.toContain(";--");
    }
  });

  it("restricts an editor to visible rows via a DB-side scope predicate", async () => {
    setupDb(fake, { admin: adminRow("editor"), total: 2, list: [memoryRow({ created_by: EDITOR_ID, owner_id: EDITOR_ID })] });
    const res = await listGet(new Request(`${BASE}/api/memories`, { headers: { cookie: sessionCookie("editor") } }));
    expect(res.status).toBe(200);

    const listSql = fake.query.mock.calls.find(
      ([sql]) => String(sql).includes("FROM memories") && String(sql).includes("ORDER BY"),
    );
    const sqlText = String(listSql?.[0] ?? "");
    expect(sqlText).toContain("privacy = 'public' OR created_by = $");
    expect(sqlText).toContain("owner_id = $");
    // params: [editorId, limit, offset]
    expect((listSql?.[1] ?? [])[0]).toBe(EDITOR_ID);
    const body = await json(res);
    expect((body.data as Array<{ created_by: string }>)[0].created_by).toBe(EDITOR_ID);
  });

  it("filter privacy applies on top of the DB scope for editors", async () => {
    setupDb(fake, { admin: adminRow("editor"), total: 0, list: [] });
    const res = await listGet(
      new Request(`${BASE}/api/memories?privacy=public`, { headers: { cookie: sessionCookie("editor") } }),
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/memories/[id]", () => {
  it("returns 400 for a non-UUID id", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const res = await detailGet(new Request(`${BASE}/api/memories/not-a-uuid`, { headers: { cookie: sessionCookie("owner") } }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: "INVALID_ID" });
  });

  it("returns 401 without a session", async () => {
    setupDb(fake, { admin: null });
    const res = await detailGet(new Request(`${BASE}/api/memories/${VALID_UUID}`), {
      params: Promise.resolve({ id: VALID_UUID }),
    });
    expect(res.status).toBe(401);
  });

  it("returns the row for an authorized admin", async () => {
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow() });
    const res = await detailGet(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, { headers: { cookie: sessionCookie("owner") } }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ id: VALID_UUID, title: "Malam Pertama" });
  });

  it("hides private/shared rows of other admins from editors (404, not 403)", async () => {
    setupDb(fake, {
      admin: adminRow("editor"),
      // DB menolak query (scope) sehingga byId = null.
      byId: null,
    });
    const res = await detailGet(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, { headers: { cookie: sessionCookie("editor") } }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(JSON.stringify(body)).not.toContain("Malam Pertama");
  });
});

describe("POST /api/memories", () => {
  it("creates a memory with created_by/owner_id from the session, not the body", async () => {
    const result = memoryRow({ created_by: EDITOR_ID, owner_id: EDITOR_ID });
    setupDb(fake, { admin: adminRow("editor"), insertResult: result });
    const res = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("editor")),
        body: JSON.stringify({
          title: "Makan Malam",
          description: "Spesial",
          memory_date: "2026-02-14",
          category: "Makan",
          privacy: "private",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data).toMatchObject({ created_by: EDITOR_ID, owner_id: EDITOR_ID });

    const insertCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO memories"));
    const params = insertCall?.[1] ?? [];
    // title, description, memory_date, category, privacy, owner_id, created_by
    expect(params.slice(5)).toEqual([EDITOR_ID, EDITOR_ID]);

    const auditCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO audit_logs"));
    const auditParams = auditCall?.[1] ?? [];
    // params: $1 actorId, $2 actorEmail, $3 actorLabel, $4 action, $5 entityId, ...
    expect(auditParams[3]).toBe("create");
    expect(auditParams[4]).toBe(VALID_UUID);
  });

  it("honors explicit privacy from the client", async () => {
    setupDb(fake, { admin: adminRow("owner"), insertResult: memoryRow({ privacy: "public" }) });
    const res = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: JSON.stringify({ title: "T", memory_date: "2026-01-01", privacy: "public" }),
      }),
    );
    expect(res.status).toBe(201);
    const insertCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO memories"));
    expect(insertCall?.[1]?.[4]).toBe("public");
  });

  it("rejects forbidden fields in the body (created_by/owner_id/id)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    for (const extra of [{ created_by: "hacker" }, { owner_id: "hacker" }, { id: "hacker" }, { created_at: "now" }]) {
      const res = await createPost(
        new Request(`${BASE}/api/memories`, {
          method: "POST",
          headers: mutationHeaders(sessionCookie("owner")),
          body: JSON.stringify({ title: "T", memory_date: "2026-01-01", ...extra }),
        }),
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const inserts = fake.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO memories"));
    expect(inserts.length).toBe(0);
  });

  it("rejects invalid bodies (422) and invalid JSON (400)", async () => {
    setupDb(fake, { admin: adminRow("owner") });
    const invalid = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: JSON.stringify({ title: "", memory_date: "2026-02-30", privacy: "secret" }),
      }),
    );
    expect(invalid.status).toBe(422);

    const badJson = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: mutationHeaders(sessionCookie("owner")),
        body: "{not json",
      }),
    );
    expect(badJson.status).toBe(400);
    expect((await json(badJson)).error).toMatchObject({ code: "INVALID_JSON" });
  });

  it("requires auth + safe mutation headers (401/403)", async () => {
    setupDb(fake, { admin: null });
    const unauth = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ title: "T", memory_date: "2026-01-01" }),
      }),
    );
    expect(unauth.status).toBe(401);

    setupDb(fake, { admin: adminRow("owner") });
    const noOrigin = await createPost(
      new Request(`${BASE}/api/memories`, {
        method: "POST",
        headers: new Headers({ "content-type": "application/json", "x-vanka-request": "1" }),
        body: JSON.stringify({ title: "T", memory_date: "2026-01-01" }),
      }),
    );
    expect(noOrigin.status).toBe(403);
  });
});

describe("PATCH /api/memories/[id]", () => {
  it("updates allowed fields and sets updated_at server-side", async () => {
    const updated = memoryRow({ title: "Judul Baru", updated_at: "2026-02-01T00:00:00.000Z" });
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow(), updateResult: updated });
    const res = await detailPatch(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(sessionCookie("owner")),
        body: JSON.stringify({ title: "Judul Baru", privacy: "shared" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ title: "Judul Baru" });

    const updateCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE memories"));
    const sqlText = String(updateCall?.[0] ?? "");
    expect(sqlText).toContain("title = $1");
    expect(sqlText).toContain("privacy = $2");
    expect(sqlText).toContain("updated_at = now()");
    expect(sqlText).not.toMatch(/created_by\s*=/);
    expect(sqlText).not.toMatch(/updated_at\s*=\s*\$\d/);

    const auditCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO audit_logs"));
    expect(auditCall?.[1]?.[3]).toBe("update");
  });

  it("rejects forbidden fields (id, created_at, created_by, owner_id, updated_at) with 422 and runs no UPDATE", async () => {
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow() });
    for (const extra of [
      { id: "other-uuid" },
      { created_at: "2020-01-01" },
      { created_by: "someone-else" },
      { owner_id: "someone-else" },
      { updated_at: "2020-01-01" },
    ]) {
      const res = await detailPatch(
        new Request(`${BASE}/api/memories/${VALID_UUID}`, {
          method: "PATCH",
          headers: mutationHeaders(sessionCookie("owner")),
          body: JSON.stringify({ title: "T", ...extra }),
        }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    const updates = fake.query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE memories"));
    expect(updates.length).toBe(0);
  });

  it("rejects an empty patch (422)", async () => {
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow() });
    const res = await detailPatch(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(sessionCookie("owner")),
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(422);
  });

  it("gives 404 when the row is hidden from an editor", async () => {
    setupDb(fake, { admin: adminRow("editor"), byId: null });
    const res = await detailPatch(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(sessionCookie("editor")),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(404);
  });

  it("gives 403 when an editor patches a visible row they do not own", async () => {
    setupDb(fake, { admin: adminRow("editor"), byId: memoryRow({ privacy: "public", created_by: OWNER_ID, owner_id: OWNER_ID }) });
    const res = await detailPatch(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(sessionCookie("editor")),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect((await json(res)).error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an editor to patch their own row", async () => {
    const row = memoryRow({ created_by: EDITOR_ID, owner_id: EDITOR_ID });
    setupDb(fake, { admin: adminRow("editor"), byId: row, updateResult: row });
    const res = await detailPatch(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(sessionCookie("editor")),
        body: JSON.stringify({ category: "Romantis" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/memories/[id]", () => {
  it("forbids editor role (403) regardless of ownership", async () => {
    setupDb(fake, { admin: adminRow("editor"), byId: memoryRow({ created_by: EDITOR_ID, owner_id: EDITOR_ID }) });
    const res = await detailDelete(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, {
        method: "DELETE",
        headers: mutationHeaders(sessionCookie("editor")),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    const deletes = fake.query.mock.calls.filter(([sql]) => String(sql).includes("DELETE FROM memories"));
    expect(deletes.length).toBe(0);
  });

  it("returns 404 when the memory does not exist", async () => {
    setupDb(fake, { admin: adminRow("owner"), byId: null });
    const res = await detailDelete(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(sessionCookie("owner")) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 on FK conflict (media RESTRICT) without leaking internals", async () => {
    const fkViolation = Object.assign(new Error('update or delete on table "memories" violates foreign key constraint "media_memory_id_fkey"'), {
      code: "23503",
    });
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow(), deleteError: fkViolation });
    const res = await detailDelete(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(sessionCookie("owner")) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.error).toMatchObject({ code: "CONFLICT" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("media_memory_id_fkey");
    expect(raw).not.toContain("foreign key");
    expect(raw).not.toContain("violates");
  });

  it("deletes when no media reference exists and writes an audit entry", async () => {
    setupDb(fake, { admin: adminRow("owner"), byId: memoryRow() });
    const res = await detailDelete(
      new Request(`${BASE}/api/memories/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(sessionCookie("owner")) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);

    const deleteCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("DELETE FROM memories WHERE"));
    expect(deleteCall?.[1]).toEqual([VALID_UUID]);
    const auditCall = fake.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO audit_logs"));
    expect(auditCall?.[1]?.[3]).toBe("delete");
    expect(auditCall?.[1]?.[4]).toBe(VALID_UUID);
  });
});

describe("error handling & audit", () => {
  it("hides DB error details behind a generic 500", async () => {
    fake.when("UPDATE sessions", ok);
    fake.when("WITH renewed AS", () => ({
      rows: [adminRow("owner")],
      rowCount: 1,
    }));
    fake.when(/SELECT count\(\*\)::int AS n FROM memories/, () => {
      throw new Error('relation "memories" does not exist');
    });
    const res = await listGet(new Request(`${BASE}/api/memories`, { headers: { cookie: sessionCookie("owner") } }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("relation");
    expect(raw).not.toContain("memories");
    expect(raw).not.toContain("node:");
    expect(raw).not.toContain("at ");
  });

  it("writeAuditLogBestEffort does not fail the main operation on audit error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      setupDb(fake, { admin: adminRow("owner"), insertResult: memoryRow() });
      fake.when("INSERT INTO audit_logs", () => {
        throw new Error("audit insert failed");
      });
      const res = await createPost(
        new Request(`${BASE}/api/memories`, {
          method: "POST",
          headers: mutationHeaders(sessionCookie("owner")),
          body: JSON.stringify({ title: "T", memory_date: "2026-01-01" }),
        }),
      );
      expect(res.status).toBe(201);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// Keeps the QueryHandler type imported for TS resolution clarity (same pattern as auth tests).
void (null as unknown as QueryHandler);