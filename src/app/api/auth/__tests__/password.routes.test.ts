import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { PUT as passwordPut } from "@/app/api/auth/password/route";
import { hashPassword } from "@/lib/auth/password";

const BASE = "https://vanka.test";
const ADMIN_ID = "admin-1";

const sessionRow = {
  id: ADMIN_ID,
  email: "owner@vanka.universe",
  name: "Vanka",
  role: "owner" as const,
  is_active: true,
  session_id: "sess-1",
};

let fake: ReturnType<typeof createFakePool>;
let goodHash: string;

function setupDb(
  options: {
    session?: typeof sessionRow | null;
    passwordHash?: string | null;
    updated?: boolean;
    sessionsRevoked?: number;
  } = {},
) {
  const session = options.session === undefined ? sessionRow : options.session;
  fake.when("WITH renewed AS", () => ({
    rows: session ? [session] : [],
    rowCount: session ? 1 : 0,
  }));
  fake.when("SELECT password_hash FROM admins", () => ({
    rows: [{ password_hash: options.passwordHash === undefined ? goodHash : options.passwordHash }],
    rowCount: 1,
  }));
  fake.when("WITH updated AS", () => ({
    rows: [
      {
        admins_updated: options.updated === false ? 0 : 1,
        sessions_revoked: options.sessionsRevoked ?? 2,
      },
    ],
    rowCount: 1,
  }));
  // Re-auth limiter (Tahap 4F1): not locked, writable by default.
  // Match on the table name, NOT "SELECT count(*)" (which is also embedded in
  // the admin-security CTE and would mis-answer it).
  fake.when("FROM login_attempts", () => ({ rows: [{ n: 0 }], rowCount: 1 }));
  fake.when("DELETE FROM login_attempts", () => ({ rows: [], rowCount: 0 }));
  fake.when("INSERT INTO login_attempts", () => ({ rows: [], rowCount: 1 }));
}

function headers(): Headers {
  const h = new Headers();
  h.set("origin", BASE);
  h.set("content-type", "application/json");
  h.set("x-vanka-request", "1");
  h.set("cookie", "vanka_session=admin-token");
  return h;
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    currentPassword: "correct-horse-battery",
    newPassword: "brand-new-secret",
    confirmPassword: "brand-new-secret",
    ...overrides,
  });
}

function updateCalls(): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) => String(sql).includes("WITH updated AS"));
}

function passwordHashCalls(): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("SELECT password_hash FROM admins"),
  );
}

beforeAll(async () => {
  goodHash = await hashPassword("correct-horse-battery");
});

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("PUT /api/auth/password", () => {
  it("requires a session (401) and runs no queries without one", async () => {
    setupDb({ session: null });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(updateCalls()).toHaveLength(0);
  });

  it("rejects an unsafe mutation (403, no CSRF header)", async () => {
    setupDb();
    const h = headers();
    h.delete("x-vanka-request");
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: h, body: body() }),
    );
    expect(res.status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin request (403)", async () => {
    setupDb();
    const h = headers();
    h.set("origin", "https://evil.example");
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: h, body: body() }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ORIGIN_REJECTED");
  });

  it("returns 422 for a mismatched confirmation before touching the DB", async () => {
    setupDb();
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, {
        method: "PUT",
        headers: headers(),
        body: body({ confirmPassword: "different-secret" }),
      }),
    );
    expect(res.status).toBe(422);
    const payload = await res.json();
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.details.reason).toBe("CONFIRM_MISMATCH");
    // Only the session check ran; no credential lookup and no update.
    expect(passwordHashCalls()).toHaveLength(0);
    expect(updateCalls()).toHaveLength(0);
  });

  it("returns 422 for a too-short new password", async () => {
    setupDb();
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, {
        method: "PUT",
        headers: headers(),
        body: body({ newPassword: "short", confirmPassword: "short" }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.reason).toBe("NEW_TOO_SHORT");
    expect(updateCalls()).toHaveLength(0);
  });

  it("returns a generic 401 and changes NOTHING when the current password is wrong", async () => {
    setupDb();
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, {
        method: "PUT",
        headers: headers(),
        body: body({ currentPassword: "wrong-password" }),
      }),
    );
    expect(res.status).toBe(401);
    const payload = await res.json();
    expect(payload.error.code).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(payload)).not.toContain("password_hash");
    expect(updateCalls()).toHaveLength(0);
  });

  it("fails closed when the admin has no stored password hash", async () => {
    setupDb({ passwordHash: null });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(401);
    expect(updateCalls()).toHaveLength(0);
  });

  it("changes the password and revokes all sessions atomically, clearing the cookie", async () => {
    setupDb({ sessionsRevoked: 3 });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.data).toEqual({
      passwordChanged: true,
      sessionsRevoked: 3,
      requiresReauth: true,
    });

    const calls = updateCalls();
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    const statement = String(sql);
    expect(statement).toContain("SET password_hash = $2");
    expect(statement).toContain("UPDATE sessions SET revoked_at = now()");
    expect(statement).toContain("admins_updated");
    expect(statement).toContain("sessions_revoked");

    const args = params as unknown[];
    expect(args[0]).toBe(ADMIN_ID);
    const storedHash = args[1] as string;
    expect(storedHash).toMatch(/^\$2[aby]\$/);
    expect(storedHash).not.toBe("brand-new-secret");

    const raw = JSON.stringify(payload);
    expect(raw).not.toContain("brand-new-secret");
    expect(raw).not.toContain("correct-horse-battery");
    expect(raw).not.toContain("$2");

    expect(res.headers.get("set-cookie") ?? "").toMatch(/vanka_session=;.*Max-Age=0/i);
  });

  it("fails closed (500) and does NOT clear the cookie when the update errors", async () => {
    setupDb();
    fake.when("WITH updated AS", () => {
      throw new Error("db down");
    });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/vanka_session=;.*Max-Age=0/i);
  });

  it("never claims success when the admin row was not updated", async () => {
    setupDb({ updated: false });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(500);
    const payload = await res.json();
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(payload)).not.toContain("passwordChanged");
  });

  it("returns 429 before any credential work when the re-auth rate limit is reached", async () => {
    setupDb();
    fake.when("FROM login_attempts", () => ({ rows: [{ n: 5 }], rowCount: 1 }));
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(429);
    const payload = await res.json();
    expect(payload.error.code).toBe("RATE_LIMITED");
    expect(passwordHashCalls()).toHaveLength(0);
    expect(updateCalls()).toHaveLength(0);
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO login_attempts")),
    ).toBe(false);
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(/vanka_session=;.*Max-Age=0/i);
  });

  it("counts a wrong re-auth password as a failure and records it", async () => {
    setupDb();
    const inserted: Array<unknown[]> = [];
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      inserted.push(params as unknown[]);
      return { rows: [], rowCount: 1 };
    });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, {
        method: "PUT",
        headers: headers(),
        body: body({ currentPassword: "wrong-password" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe(sessionRow.email);
    expect(inserted[0][1]).toBeNull(); // no trusted IP configured
    expect(inserted[0][2]).toBe(false);
    expect(updateCalls()).toHaveLength(0);
  });

  it("records a success (clearing failures) after a correct password", async () => {
    setupDb({ sessionsRevoked: 1 });
    const inserted: Array<unknown[]> = [];
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      inserted.push(params as unknown[]);
      return { rows: [], rowCount: 1 };
    });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][2]).toBe(true);
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM login_attempts")),
    ).toBe(true);
  });

  it("honours the identity+IP limiter path when a trusted proxy header is configured", async () => {
    process.env.ARCHIVE_TRUSTED_PROXY_HEADER = "x-forwarded-for";
    try {
      setupDb();
      fake.when("FROM login_attempts", (sql: string) => {
        const n = sql.includes("email = $1") ? 5 : 0;
        return { rows: [{ n }], rowCount: 1 };
      });
      const h = headers();
      h.set("x-forwarded-for", "203.0.113.11");
      const res = await passwordPut(
        new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: h, body: body() }),
      );
      expect(res.status).toBe(429);
      expect((await res.json()).error.code).toBe("RATE_LIMITED");
      expect(passwordHashCalls()).toHaveLength(0);
    } finally {
      delete process.env.ARCHIVE_TRUSTED_PROXY_HEADER;
    }
  });

  it("fails closed (500) without verifying the password when the limiter errors", async () => {
    setupDb();
    fake.when("FROM login_attempts", () => {
      throw new Error("db down");
    });
    const res = await passwordPut(
      new Request(`${BASE}/api/auth/password`, { method: "PUT", headers: headers(), body: body() }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
    // Verification must never run when the limiter fails.
    expect(passwordHashCalls()).toHaveLength(0);
    expect(updateCalls()).toHaveLength(0);
  });
});
