import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { GET as accessGet, POST as accessPost } from "@/app/api/archive/access/route";
import { POST as logoutPost } from "@/app/api/archive/access/logout/route";
import { POST as lockPost } from "@/app/api/archive/access/lock/route";
import { hashPin } from "@/lib/archive/access/pin";
import {
  ARCHIVE_ACCESS_COOKIE_NAME,
} from "@/lib/archive/access/policy";
import {
  ARCHIVE_MAX_FAILURES_PER_IP,
} from "@/lib/archive/access/policy";

const BASE = "https://vanka.test";
const VISITOR_COOKIE = `${ARCHIVE_ACCESS_COOKIE_NAME}=visitor-token`;

type Fake = ReturnType<typeof createFakePool>;

const ok = (): FakeResult => ({ rows: [], rowCount: 1 });

function undefinedTable(): never {
  throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
}

function undefinedColumn(): never {
  throw Object.assign(new Error('column "pin_hash" does not exist'), { code: "42703" });
}

/** Per-IP query filters on `ip_address = $1`; the global query does not. */
function countHandler(perIp: number, global: number) {
  return (sql: string) => {
    const n = sql.includes("ip_address = $1") ? perIp : global;
    return { rows: [{ n }], rowCount: 1 };
  };
}

function mutationHeaders(cookie?: string): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("content-type", "application/json");
  headers.set("x-vanka-request", "1");
  headers.set("x-forwarded-for", "203.0.113.7");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Route handlers are typed `Response`; the cookie jar lives on the concrete value. */
function cookies(res: Response): {
  get(name: string): { value?: string; httpOnly?: boolean; maxAge?: number } | undefined;
} {
  return (res as unknown as {
    cookies: { get(name: string): { value?: string; httpOnly?: boolean; maxAge?: number } | undefined };
  }).cookies;
}

function errorCode(payload: Record<string, unknown>): string | undefined {
  const error = payload.error as { code?: string } | undefined;
  return error?.code;
}

let fake: Fake;
let pinHash: string;

beforeAll(async () => {
  pinHash = await hashPin("4821");
});

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  // Rate limiting resolves the client IP only from an explicitly configured
  // trusted-proxy header (Tahap 3D). Configure it for the "happy path" tests.
  process.env.ARCHIVE_TRUSTED_PROXY_HEADER = "x-forwarded-for";
});

/** Standard handlers: not locked, PIN configured, session + attempts writable. */
function setup(f: Fake, opts: { pinHashValue?: string | null; sessionInsert?: boolean } = {}) {
  f.when("SELECT count(*)", countHandler(0, 0));
  f.when("SELECT pin_hash, access_enabled, access_version", () => ({
    rows: [
      {
        pin_hash: opts.pinHashValue === undefined ? pinHash : opts.pinHashValue,
        access_enabled: true,
        access_version: 1,
      },
    ],
    rowCount: 1,
  }));
  f.when("INSERT INTO archive_access_sessions", () => ({ rows: [{ id: "s1" }], rowCount: 1 }));
  f.when("DELETE FROM archive_access_attempts", ok);
  f.when("INSERT INTO archive_access_attempts", ok);
  f.when("UPDATE archive_access_sessions SET revoked_at", ok);
  if (opts.sessionInsert === false) {
    f.when("INSERT INTO archive_access_sessions", () => ({ rows: [], rowCount: 0 }));
  }
}

describe("POST /api/archive/access", () => {
  it("rejects an unsafe mutation (403, no CSRF header)", async () => {
    setup(fake);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, { method: "POST", body: JSON.stringify({ pin: "4821" }) }),
    );
    expect(res.status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("opens a session with the correct PIN and sets the visitor cookie", async () => {
    setup(fake);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(200);
    const payload = await json(res);
    expect(payload.data).toEqual({ unlocked: true });

    // No secret leaks: no PIN, no hash, no raw token in the body.
    const text = JSON.stringify(payload);
    expect(text).not.toContain("4821");
    expect(text).not.toContain(pinHash);
    expect(text).not.toContain("$2");

    const cookie = cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME);
    expect(cookie?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("records a failure and returns a generic 401 for a wrong PIN", async () => {
    setup(fake);
    let recordedSuccess: unknown;
    fake.when("INSERT INTO archive_access_attempts", (_sql, params) => {
      recordedSuccess = (params as unknown[])[1];
      return ok();
    });
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "0000" }),
      }),
    );
    expect(res.status).toBe(401);
    const payload = await json(res);
    expect(errorCode(payload)).toBe("INVALID_PIN");
    expect(recordedSuccess).toBe(false);
    // The failure message must not reveal whether a PIN/archive exists.
    expect(JSON.stringify(payload)).not.toContain("archiv");
  });

  it("returns a generic 401 when no archive row exists (fail-closed)", async () => {
    fake.when("SELECT count(*)", countHandler(0, 0));
    fake.when("SELECT pin_hash, access_enabled, access_version", () => ({ rows: [], rowCount: 0 }));
    fake.when("INSERT INTO archive_access_attempts", ok);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "1234" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(errorCode(await json(res))).toBe("INVALID_PIN");
  });

  it("validates the PIN format server-side (422) without touching the database", async () => {
    setup(fake);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "12" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects an empty PIN as invalid input (422)", async () => {
    setup(fake);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("returns 429 before verifying when the rate limit is reached", async () => {
    fake.when("SELECT count(*)", countHandler(ARCHIVE_MAX_FAILURES_PER_IP, 0));
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(429);
    expect(errorCode(await json(res))).toBe("RATE_LIMITED");
    // Verification must never run once locked.
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("SELECT pin_hash")),
    ).toBe(false);
  });

  it("fails closed with a safe 503 when the access schema is missing", async () => {
    fake.when("SELECT count(*)", countHandler(0, 0));
    fake.when("SELECT pin_hash, access_enabled, access_version", () => undefinedTable());
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(503);
    const payload = await json(res);
    expect(errorCode(payload)).toBe("ARCHIVE_ACCESS_UNAVAILABLE");
    expect(JSON.stringify(payload)).not.toContain(pinHash);
  });

  it("fails closed with a safe 503 when a required column is missing (42703)", async () => {
    setup(fake);
    fake.when("INSERT INTO archive_access_sessions", () => undefinedColumn());
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(errorCode(await json(res))).toBe("ARCHIVE_ACCESS_UNAVAILABLE");
  });

  it("fails closed (503) when no trusted IP identity is available", async () => {
    delete process.env.ARCHIVE_TRUSTED_PROXY_HEADER;
    setup(fake);
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(errorCode(await json(res))).toBe("ARCHIVE_ACCESS_UNAVAILABLE");
    // No rate-limit or PIN query runs without an identity.
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("ignores a spoofed untrusted header (only the configured one counts)", async () => {
    process.env.ARCHIVE_TRUSTED_PROXY_HEADER = "cf-connecting-ip";
    setup(fake);
    const headers = mutationHeaders();
    headers.set("x-forwarded-for", "1.2.3.4"); // spoofed, must be ignored
    const res = await accessPost(
      new Request(`${BASE}/api/archive/access`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pin: "4821" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(fake.query).not.toHaveBeenCalled();
  });
});

describe("GET /api/archive/access", () => {
  it("returns unlocked:false without querying when there is no visitor cookie", async () => {
    const res = await accessGet(new Request(`${BASE}/api/archive/access`));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: false });
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("returns unlocked:true for a valid visitor session", async () => {
    fake.when("FROM archive_access_sessions s", () => ({ rows: [{ id: "s1" }], rowCount: 1 }));
    const res = await accessGet(
      new Request(`${BASE}/api/archive/access`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: true });
  });

  it("returns unlocked:false for an invalid/expired/revoked token", async () => {
    fake.when("FROM archive_access_sessions s", () => ({ rows: [], rowCount: 0 }));
    const res = await accessGet(
      new Request(`${BASE}/api/archive/access`, { headers: { cookie: VISITOR_COOKIE } }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: false });
  });

  it("ignores the admin session cookie (no visitor unlock)", async () => {
    const res = await accessGet(
      new Request(`${BASE}/api/archive/access`, { headers: { cookie: "vanka_session=admin-token" } }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: false });
    expect(fake.query).not.toHaveBeenCalled();
  });
});

describe("POST /api/archive/access/logout", () => {
  it("requires safe mutation headers (403)", async () => {
    const res = await logoutPost(
      new Request(`${BASE}/api/archive/access/logout`, { method: "POST" }),
    );
    expect(res.status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("revokes the visitor session and clears the cookie", async () => {
    setup(fake);
    const res = await logoutPost(
      new Request(`${BASE}/api/archive/access/logout`, {
        method: "POST",
        headers: mutationHeaders(VISITOR_COOKIE),
      }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: false });
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE archive_access_sessions SET revoked_at"),
      ),
    ).toBe(true);
  });

  it("is a safe no-op without a cookie (still clears it)", async () => {
    const res = await logoutPost(
      new Request(`${BASE}/api/archive/access/logout`, {
        method: "POST",
        headers: mutationHeaders(),
      }),
    );
    expect(res.status).toBe(200);
    expect(fake.query).not.toHaveBeenCalled();
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("still clears the cookie when the access schema is unavailable", async () => {
    fake.when("UPDATE archive_access_sessions SET revoked_at", () => undefinedTable());
    const res = await logoutPost(
      new Request(`${BASE}/api/archive/access/logout`, {
        method: "POST",
        headers: mutationHeaders(VISITOR_COOKIE),
      }),
    );
    expect(res.status).toBe(200);
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
  });
});

describe("POST /api/archive/access/lock (beacon-only, no custom header)", () => {
  /** Beacon headers: origin + JSON content type, but NO `x-vanka-request`. */
  function beaconHeaders(cookie?: string): Headers {
    const headers = new Headers();
    headers.set("origin", BASE);
    headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    return headers;
  }

  it("revokes the visitor session and clears the cookie WITHOUT the custom header", async () => {
    setup(fake);
    const res = await lockPost(
      new Request(`${BASE}/api/archive/access/lock`, {
        method: "POST",
        headers: beaconHeaders(VISITOR_COOKIE),
      }),
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ unlocked: false });
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE archive_access_sessions SET revoked_at"),
      ),
    ).toBe(true);
  });

  it("rejects a cross-origin beacon", async () => {
    setup(fake);
    const headers = beaconHeaders(VISITOR_COOKIE);
    headers.set("origin", "https://evil.example");
    const res = await lockPost(
      new Request(`${BASE}/api/archive/access/lock`, {
        method: "POST",
        headers,
      }),
    );
    expect(res.status).toBe(403);
    expect(errorCode(await json(res))).toBe("ORIGIN_REJECTED");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type (an HTML form cannot produce it)", async () => {
    setup(fake);
    const headers = beaconHeaders(VISITOR_COOKIE);
    headers.set("content-type", "application/x-www-form-urlencoded");
    const res = await lockPost(
      new Request(`${BASE}/api/archive/access/lock`, {
        method: "POST",
        headers,
      }),
    );
    expect(res.status).toBe(403);
    expect(errorCode(await json(res))).toBe("CONTENT_TYPE_REJECTED");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("still clears the cookie when the access schema is unavailable", async () => {
    fake.when("UPDATE archive_access_sessions SET revoked_at", () => undefinedTable());
    const res = await lockPost(
      new Request(`${BASE}/api/archive/access/lock`, {
        method: "POST",
        headers: beaconHeaders(VISITOR_COOKIE),
      }),
    );
    expect(res.status).toBe(200);
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
  });

  it("still clears the cookie when the revoke fails with a generic database error", async () => {
    // Fail-closed: a revoke that cannot be confirmed (any DB failure, not just
    // a missing schema) must still clear the visitor cookie. A stale cookie
    // would leave the archive unlocked.
    fake.when("UPDATE archive_access_sessions SET revoked_at", () => {
      throw new Error("connection terminated unexpectedly");
    });
    const res = await lockPost(
      new Request(`${BASE}/api/archive/access/lock`, {
        method: "POST",
        headers: beaconHeaders(VISITOR_COOKIE),
      }),
    );
    expect(res.status).toBe(200);
    expect(cookies(res).get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
  });
});
