import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

import { createFakePool, type QueryHandler, type FakeResult } from "@/lib/auth/__tests__/fake-db";
import { hashToken } from "@/lib/auth/session";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { hashPassword } from "@/lib/auth/password";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as meGet } from "@/app/api/auth/me/route";

const BASE = "https://vanka.test";
let goodHash: string;

type AdminFixture = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "editor";
  is_active: boolean;
  password_hash: string | null;
};

const adminRow: AdminFixture = {
  id: "admin-1",
  email: "owner@vanka.universe",
  name: "Vanka",
  role: "owner",
  is_active: true,
  password_hash: null as string | null,
};

const sessionRow = {
  id: "admin-1",
  email: "owner@vanka.universe",
  name: "Vanka",
  role: "owner",
  is_active: true,
  session_id: "sess-1",
};

const ok = (): FakeResult => ({ rows: [], rowCount: 1 });

function setupFake(
  fake: ReturnType<typeof createFakePool>,
  opts: { admin?: AdminFixture | null; count?: number; session?: typeof sessionRow | null } = {},
) {
  fake.when("SELECT count(*)", () => ({ rows: [{ n: opts.count ?? 0 }], rowCount: 1 }));
  fake.when("SELECT id, email, name, role, is_active, password_hash", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("INSERT INTO sessions", (_sql, params) => {
    (globalThis as { __capturedTokenHash?: string }).__capturedTokenHash = (params as unknown[])[1] as string;
    return ok();
  });
  fake.when("UPDATE admins SET last_login_at", ok);
  fake.when("INSERT INTO login_attempts", ok);
  fake.when("DELETE FROM login_attempts", ok);
  fake.when("UPDATE sessions", ok);
  // Registered last so it wins for the merged validation+renewal statement,
  // which also contains "UPDATE sessions" inside its CTE.
  fake.when("WITH renewed AS", () => ({
    rows: opts.session ? [opts.session] : [],
    rowCount: opts.session ? 1 : 0,
  }));
}

let fake: ReturnType<typeof createFakePool>;

beforeAll(async () => {
  goodHash = await hashPassword("correct-horse-battery");
});

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  (globalThis as { __capturedTokenHash?: string }).__capturedTokenHash = undefined;
});

function mutationHeaders(cookie?: string): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("content-type", "application/json");
  headers.set("x-vanka-request", "1");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

function extractSessionToken(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/vanka_session=([^;]+)/);
  if (!match) throw new Error(`no session cookie in: ${setCookie}`);
  return match[1];
}

describe("POST /api/auth/login", () => {
  it("logs in a valid active admin and sets a session cookie holding only raw token", async () => {
    setupFake(fake, { admin: { ...adminRow, password_hash: goodHash } });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "owner@vanka.universe", password: "correct-horse-battery" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.admin.email).toBe("owner@vanka.universe");
    expect(body.data.admin.role).toBe("owner");

    const token = extractSessionToken(res);
    const captured = (globalThis as { __capturedTokenHash?: string }).__capturedTokenHash;
    expect(captured).toBe(hashToken(token));
  });

  it("rejects a wrong password with a generic 401 and no internal leaks", async () => {
    setupFake(fake, { admin: { ...adminRow, password_hash: goodHash } });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "owner@vanka.universe", password: "wrong-password" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toBe("Email atau kata sandi salah.");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("SELECT");
    expect(raw).not.toContain("node:");
  });

  it("rejects an unknown email with the same generic 401 (dummy comparison)", async () => {
    setupFake(fake, { admin: null });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "nobody@vanka.universe", password: "whatever" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an inactive admin with a generic 401", async () => {
    setupFake(fake, { admin: { ...adminRow, is_active: false, password_hash: goodHash } });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "owner@vanka.universe", password: "correct-horse-battery" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 422 for invalid input", async () => {
    setupFake(fake, { admin: null });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "not-an-email", password: "" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 429 when rate limited", async () => {
    setupFake(fake, { admin: { ...adminRow, password_hash: goodHash }, count: 5 });
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ email: "owner@vanka.universe", password: "correct-horse-battery" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    // no session should have been created
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO sessions"))).toBe(false);
  });

  it("rejects a cross-origin request (CSRF)", async () => {
    setupFake(fake, { admin: { ...adminRow, password_hash: goodHash } });
    const headers = mutationHeaders();
    headers.set("origin", "https://evil.example");
    const request = new Request(`${BASE}/api/auth/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "owner@vanka.universe", password: "correct-horse-battery" }),
    });

    const res = await loginPost(request);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ORIGIN_REJECTED");
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    setupFake(fake, { session: sessionRow });
    const request = new Request(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: mutationHeaders("vanka_session=some-token"),
      body: "{}",
    });

    const res = await logoutPost(request);
    expect(res.status).toBe(200);
    const revokedCall = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE sessions SET revoked_at"),
    );
    expect(revokedCall).toBeDefined();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/vanka_session=;.*Max-Age=0/i);
  });

  it("returns 401 without a session", async () => {
    setupFake(fake, { session: null });
    const request = new Request(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: mutationHeaders(),
      body: "{}",
    });

    const res = await logoutPost(request);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an already-revoked/expired session (cookie not cleared)", async () => {
    setupFake(fake, { session: null });
    const request = new Request(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: mutationHeaders("vanka_session=stale-token"),
      body: "{}",
    });

    const res = await logoutPost(request);
    expect(res.status).toBe(401);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("SET revoked_at"))).toBe(false);
  });

  it("returns 500 and does NOT clear the cookie when revocation fails on the database", async () => {
    setupFake(fake, { session: sessionRow });
    // Registered last so it overrides the generic "UPDATE sessions" handler.
    fake.when("UPDATE sessions SET revoked_at", async () => {
      throw new Error("db down");
    });

    const request = new Request(`${BASE}/api/auth/logout`, {
      method: "POST",
      headers: mutationHeaders("vanka_session=some-token"),
      body: "{}",
    });

    const res = await logoutPost(request);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
    // Fail-closed: the session was NOT revoked and the cookie must NOT be
    // cleared as if logout had succeeded.
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/vanka_session=;.*Max-Age=0/i);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the admin for a valid session", async () => {
    setupFake(fake, { session: sessionRow });
    const request = new Request(`${BASE}/api/auth/me`, {
      headers: { cookie: "vanka_session=some-token" },
    });

    const res = await meGet(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.admin.email).toBe("owner@vanka.universe");
  });

  it("rejects without a session cookie", async () => {
    setupFake(fake, { session: null });
    const res = await meGet(new Request(`${BASE}/api/auth/me`));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a revoked or inactive-admin session (no row from validation)", async () => {
    setupFake(fake, { session: null });
    const res = await meGet(
      new Request(`${BASE}/api/auth/me`, { headers: { cookie: "vanka_session=stale-token" } }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("returns 500 when session validation fails at the database", async () => {
    setupFake(fake, { session: sessionRow });
    fake.when("WITH renewed AS", async () => {
      throw new Error("db down");
    });

    const res = await meGet(
      new Request(`${BASE}/api/auth/me`, { headers: { cookie: "vanka_session=some-token" } }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

// Keeps the QueryHandler type imported in this file for TS resolution clarity.
void (null as unknown as QueryHandler);