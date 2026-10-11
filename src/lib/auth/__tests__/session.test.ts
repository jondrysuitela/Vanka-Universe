import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  createSession,
  generateToken,
  getSessionAdmin,
  hashToken,
  readSessionToken,
  revokeAllSessions,
  revokeAllSessionsExcept,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("session tokens", () => {
  it("hashToken produces 64-char hex, deterministic", () => {
    const h1 = hashToken("abc");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).toBe(h1);
    expect(hashToken("abd")).not.toBe(h1);
  });

  it("generateToken produces unique raw 64-char hex tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("createSession stores hashed token only and returns raw token", async () => {
    let storedTokenHash: unknown;
    fake.when("INSERT INTO sessions", (_sql, params) => {
      storedTokenHash = (params as unknown[])[1];
      return { rows: [], rowCount: 1 };
    });
    const token = await createSession({ adminId: "admin-1", ipAddress: "10.0.0.1" });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(storedTokenHash).toBe(hashToken(token));
  });
});

describe("getSessionAdmin", () => {
  const row = {
    id: "admin-1",
    email: "owner@vanka.universe",
    name: "Vanka",
    role: "owner",
    is_active: true,
    session_id: "sess-1",
  };

  it("validates and renews in ONE statement and returns the admin", async () => {
    fake.when("WITH renewed AS", () => ({ rows: [row], rowCount: 1 }));

    const admin = await getSessionAdmin(generateToken());
    expect(admin).toEqual({
      id: "admin-1",
      email: "owner@vanka.universe",
      name: "Vanka",
      role: "owner",
    });

    // Exactly one database round-trip: validation + renewal are atomic.
    expect(fake.query).toHaveBeenCalledTimes(1);
    const sql = String(fake.query.mock.calls[0]?.[0] ?? "");
    // Revoked sessions can never be revived or renewed.
    expect(sql).toContain("revoked_at IS NULL");
    // Sliding expiry and the absolute 30-day deadline are both enforced.
    expect(sql).toContain("expires_at > now()");
    expect(sql).toContain("created_at + interval '30 days' > now()");
    expect(sql).toContain("LEAST");
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("interval '30 days'");
    // Inactive admins are rejected (inside the renewal guard and in the join).
    expect(sql).toContain("is_active = true");
  });

  it("returns null when no row matches (missing/expired/revoked/inactive)", async () => {
    fake.when("WITH renewed AS", () => ({ rows: [], rowCount: 0 }));
    await expect(getSessionAdmin(generateToken())).resolves.toBeNull();
  });

  it("returns null for an empty token and issues no query", async () => {
    await expect(getSessionAdmin("")).resolves.toBeNull();
    await expect(getSessionAdmin(null)).resolves.toBeNull();
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects on a database error instead of returning a session", async () => {
    fake.when("WITH renewed AS", async () => {
      throw new Error("db down");
    });
    await expect(getSessionAdmin(generateToken())).rejects.toThrow("db down");
  });
});

describe("revocation", () => {
  it("revokeSession updates by hashed token and only affects the current session", async () => {
    fake.when("UPDATE sessions SET revoked_at", () => ({ rows: [], rowCount: 1 }));
    const token = generateToken();
    await revokeSession(token);
    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("WHERE token_hash = $1 AND revoked_at IS NULL");
    expect(params).toEqual([hashToken(token)]);
  });

  it("revokeAllSessions scopes to the given admin and non-revoked sessions", async () => {
    fake.when("UPDATE sessions SET revoked_at", () => ({ rows: [], rowCount: 2 }));
    await revokeAllSessions("admin-1");
    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("WHERE admin_id = $1 AND revoked_at IS NULL");
    expect(params).toEqual(["admin-1"]);
  });

  it("revokeAllSessionsExcept keeps one session and still scopes to the admin", async () => {
    fake.when("UPDATE sessions SET revoked_at", () => ({ rows: [], rowCount: 2 }));
    await revokeAllSessionsExcept("admin-1", "sess-keep");
    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("admin_id = $1");
    expect(String(sql)).toContain("revoked_at IS NULL");
    expect(String(sql)).toContain("id <> $2");
    expect(params).toEqual(["admin-1", "sess-keep"]);
  });

  it("revokeAllSessionsExcept rejects without ids and issues no query", async () => {
    await expect(revokeAllSessionsExcept("", "sess-keep")).rejects.toThrow(/adminId/);
    await expect(revokeAllSessionsExcept("admin-1", "")).rejects.toThrow(/keepSessionId/);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("revokeSession propagates database errors (never swallowed)", async () => {
    fake.when("UPDATE sessions SET revoked_at", async () => {
      throw new Error("revoke failed");
    });
    await expect(revokeSession(generateToken())).rejects.toThrow("revoke failed");
  });

  it("revokeAllSessions propagates database errors (never swallowed)", async () => {
    fake.when("UPDATE sessions SET revoked_at", async () => {
      throw new Error("revoke-all failed");
    });
    await expect(revokeAllSessions("admin-1")).rejects.toThrow("revoke-all failed");
  });
});

describe("cookie helpers", () => {
  it("reads the session token from a Cookie header", () => {
    const request = new Request("https://vanka.test/", {
      headers: { cookie: `other=x; ${SESSION_COOKIE_NAME}=tok123; more=y` },
    });
    expect(readSessionToken(request)).toBe("tok123");
    expect(readSessionToken(new Request("https://vanka.test/"))).toBeNull();
  });

  it("sets an HttpOnly, SameSite=Lax cookie with 30-day maxAge", () => {
    const res = NextResponse.json({});
    setSessionCookie(res, "tok456");
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("tok456");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);

    clearSessionCookie(res);
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.maxAge).toBe(0);
  });
});