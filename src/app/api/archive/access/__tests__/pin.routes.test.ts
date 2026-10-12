import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { PUT as pinPut } from "@/app/api/archive/access/pin/route";
import { hashPassword } from "@/lib/auth/password";

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

function setupDb(
  fake: Fake,
  opts: { admin?: ReturnType<typeof adminRow> | null; passwordHash?: string | null } = {},
) {
  fake.when("UPDATE sessions", ok);
  fake.when("WITH renewed AS", () => ({
    rows: opts.admin ? [opts.admin] : [],
    rowCount: opts.admin ? 1 : 0,
  }));
  fake.when("SELECT password_hash FROM admins", () => ({
    rows: [{ password_hash: opts.passwordHash ?? null }],
    rowCount: 1,
  }));
  fake.when("INSERT INTO private_archives (slug, status, created_by, pin_hash", () => ({
    rows: [{ access_version: 2 }],
    rowCount: 1,
  }));
  // Re-auth limiter (Tahap 4F1): not locked, writable by default. Match on the
  // table name (not the bare "SELECT count(*)" pattern) to avoid colliding with
  // other statements that embed a count(*) subquery.
  fake.when("FROM login_attempts", () => ({ rows: [{ n: 0 }], rowCount: 1 }));
  fake.when("DELETE FROM login_attempts", () => ({ rows: [], rowCount: 0 }));
  fake.when("INSERT INTO login_attempts", () => ({ rows: [], rowCount: 1 }));
}

function mutationHeaders(): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("content-type", "application/json");
  headers.set("x-vanka-request", "1");
  headers.set("cookie", "vanka_session=admin-token");
  return headers;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function errorCode(payload: Record<string, unknown>): string | undefined {
  const error = payload.error as { code?: string } | undefined;
  return error?.code;
}

function pinCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO private_archives (slug, status, created_by, pin_hash"),
  );
}

function passwordCalls(fake: Fake): Array<[string, unknown[]?]> {
  return fake.query.mock.calls.filter(([sql]) =>
    String(sql).includes("SELECT password_hash FROM admins"),
  );
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ pin: "4821", currentPassword: "admin-pass", ...overrides });
}

let fake: Fake;
let adminPasswordHash: string;

beforeAll(async () => {
  adminPasswordHash = await hashPassword("admin-pass");
});

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("PUT /api/archive/access/pin", () => {
  it("rejects an unsafe mutation (403, no CSRF header)", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, { method: "PUT", body: body() }),
    );
    expect(res.status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("requires an admin session (401)", async () => {
    setupDb(fake, { admin: null });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(401);
    expect(pinCalls(fake)).toHaveLength(0);
  });

  it("denies an editor (403) before any password or PIN work", async () => {
    setupDb(fake, { admin: adminRow("editor"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(403);
    expect(passwordCalls(fake)).toHaveLength(0);
    expect(pinCalls(fake)).toHaveLength(0);
  });

  it("rejects a malformed PIN (422) before re-authentication", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body({ pin: "abcd" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(passwordCalls(fake)).toHaveLength(0);
    expect(pinCalls(fake)).toHaveLength(0);
  });

  it("returns a generic 401 and changes NOTHING when the password is wrong", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body({ currentPassword: "wrong-password" }),
      }),
    );
    expect(res.status).toBe(401);
    const payload = await json(res);
    expect(errorCode(payload)).toBe("INVALID_CREDENTIALS");
    // No PIN update and no access_version bump.
    expect(pinCalls(fake)).toHaveLength(0);
    expect(JSON.stringify(payload)).not.toContain("accessVersion");
  });

  it("fails closed when the admin has no stored password hash", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: null });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(401);
    expect(errorCode(await json(res))).toBe("INVALID_CREDENTIALS");
    expect(pinCalls(fake)).toHaveLength(0);
  });

  it("changes the PIN only after re-auth, bumping access_version, leaking no secret", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(200);
    const payload = await json(res);
    expect(payload.data).toEqual({ accessVersion: 2 });

    const calls = pinCalls(fake);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    const statement = String(sql);
    // Regression guard: the "ensure row then UPDATE" variant used a
    // `WITH ensure AS (INSERT ...) ... UPDATE` CTE, which reads ONE snapshot and
    // silently updated 0 rows on the very first PIN change. The upsert MUST stay
    // a single INSERT ... ON CONFLICT DO UPDATE.
    expect(statement).not.toMatch(/WITH\s+ensure/i);
    expect(statement).toContain("INSERT INTO private_archives");
    expect(statement).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(statement).toContain("pin_hash = EXCLUDED.pin_hash");
    expect(statement).toContain("pin_updated_at = now()");
    expect(statement).toContain("access_version = private_archives.access_version + 1");

    const storedHash = (params as unknown[])[2];
    expect(typeof storedHash).toBe("string");
    expect(storedHash).not.toBe("4821");
    expect(storedHash).toMatch(/^\$2[aby]\$/);

    const text = JSON.stringify(payload);
    expect(text).not.toContain("4821");
    expect(text).not.toContain("admin-pass");
    expect(text).not.toContain("$2");
    expect(text).not.toContain("pin_hash");
  });

  it("allows the admin role (not just owner)", async () => {
    setupDb(fake, { admin: adminRow("admin"), passwordHash: adminPasswordHash });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(200);
    expect(pinCalls(fake)).toHaveLength(1);
  });

  it("fails closed with a safe 503 when the schema is missing, without claiming success", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    fake.when("INSERT INTO private_archives (slug, status, created_by, pin_hash", () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(503);
    const payload = await json(res);
    expect(errorCode(payload)).toBe("ARCHIVE_ACCESS_UNAVAILABLE");
    expect(JSON.stringify(payload)).not.toContain("accessVersion");
  });

  it("returns 429 before any credential or PIN work when the re-auth limit is reached", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    fake.when("FROM login_attempts", () => ({ rows: [{ n: 5 }], rowCount: 1 }));
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(429);
    expect(errorCode(await json(res))).toBe("RATE_LIMITED");
    expect(passwordCalls(fake)).toHaveLength(0);
    expect(pinCalls(fake)).toHaveLength(0);
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO login_attempts")),
    ).toBe(false);
    // No access_version bump happens when throttled.
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("access_version = private_archives.access_version + 1")),
    ).toBe(false);
  });

  it("records a wrong re-auth password as a failure and changes NO PIN", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const inserted: Array<unknown[]> = [];
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      inserted.push(params as unknown[]);
      return { rows: [], rowCount: 1 };
    });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body({ currentPassword: "wrong-password" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe(adminRow("owner").email);
    expect(inserted[0][2]).toBe(false);
    expect(pinCalls(fake)).toHaveLength(0);
  });

  it("records a success (clearing failures) after correct re-auth", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    const inserted: Array<unknown[]> = [];
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      inserted.push(params as unknown[]);
      return { rows: [], rowCount: 1 };
    });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body({ pin: "4821" }),
      }),
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
      setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
      fake.when("FROM login_attempts", (sql: string) => {
        const n = sql.includes("email = $1") ? 5 : 0;
        return { rows: [{ n }], rowCount: 1 };
      });
      const headers = mutationHeaders();
      headers.set("x-forwarded-for", "203.0.113.11");
      const res = await pinPut(
        new Request(`${BASE}/api/archive/access/pin`, {
          method: "PUT",
          headers,
          body: body(),
        }),
      );
      expect(res.status).toBe(429);
      expect(errorCode(await json(res))).toBe("RATE_LIMITED");
      expect(passwordCalls(fake)).toHaveLength(0);
    } finally {
      delete process.env.ARCHIVE_TRUSTED_PROXY_HEADER;
    }
  });

  it("fails closed (500) without verifying the password when the limiter errors", async () => {
    setupDb(fake, { admin: adminRow("owner"), passwordHash: adminPasswordHash });
    fake.when("FROM login_attempts", () => {
      throw new Error("db down");
    });
    const res = await pinPut(
      new Request(`${BASE}/api/archive/access/pin`, {
        method: "PUT",
        headers: mutationHeaders(),
        body: body(),
      }),
    );
    expect(res.status).toBe(500);
    expect(errorCode(await json(res))).toBe("INTERNAL_ERROR");
    expect(passwordCalls(fake)).toHaveLength(0);
    expect(pinCalls(fake)).toHaveLength(0);
  });
});
