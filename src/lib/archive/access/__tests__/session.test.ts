import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  clearArchiveAccessCookie,
  createArchiveAccessSession,
  generateAccessToken,
  hashAccessToken,
  readArchiveAccessToken,
  revokeArchiveAccessSession,
  setArchiveAccessCookie,
  validateArchiveAccessSession,
} from "@/lib/archive/access/session";
import {
  ArchiveAccessDisabledError,
  ArchiveAccessUnavailableError,
} from "@/lib/archive/access/errors";
import {
  ARCHIVE_ACCESS_COOKIE_NAME,
  ARCHIVE_ACCESS_TTL_HOURS,
} from "@/lib/archive/access/policy";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

function undefinedTableError(): Error & { code: string } {
  const error = new Error("relation does not exist") as Error & { code: string };
  error.code = "42P01";
  return error;
}

describe("visitor access tokens", () => {
  it("hashAccessToken produces 64-char hex, deterministic", () => {
    const h1 = hashAccessToken("abc");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessToken("abc")).toBe(h1);
    expect(hashAccessToken("abd")).not.toBe(h1);
  });

  it("generateAccessToken produces unique raw 64-char hex tokens", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("uses a cookie name distinct from the admin session cookie", () => {
    expect(ARCHIVE_ACCESS_COOKIE_NAME).toBe("vanka_archive_access");
    expect(ARCHIVE_ACCESS_COOKIE_NAME).not.toBe("vanka_session");
  });
});

describe("createArchiveAccessSession", () => {
  it("stores only the hashed token and returns the raw token", async () => {
    let storedTokenHash: unknown;
    fake.when("INSERT INTO archive_access_sessions", (_sql, params) => {
      storedTokenHash = (params as unknown[])[1];
      return { rows: [{ id: "sess-1" }], rowCount: 1 };
    });

    const token = await createArchiveAccessSession({ ipAddress: "10.0.0.1" });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(storedTokenHash).toBe(hashAccessToken(token));
  });

  it("requires the archive PIN to be set and access enabled (fail-closed)", async () => {
    fake.when("INSERT INTO archive_access_sessions", () => ({ rows: [], rowCount: 0 }));
    await expect(createArchiveAccessSession()).rejects.toBeInstanceOf(
      ArchiveAccessDisabledError,
    );

    expect(fake.query).toHaveBeenCalledTimes(1);
    const statement = String(fake.query.mock.calls[0]?.[0] ?? "");
    expect(statement).toContain("FROM private_archives");
    expect(statement).toContain("access_enabled = true");
    expect(statement).toContain("pin_hash IS NOT NULL");
  });

  it("fails closed with a typed error when the table is missing (42P01)", async () => {
    fake.when("INSERT INTO archive_access_sessions", () => {
      throw undefinedTableError();
    });
    await expect(createArchiveAccessSession()).rejects.toBeInstanceOf(
      ArchiveAccessUnavailableError,
    );
  });

  it("propagates other database errors", async () => {
    fake.when("INSERT INTO archive_access_sessions", () => {
      throw new Error("db down");
    });
    await expect(createArchiveAccessSession()).rejects.toThrow("db down");
  });
});

describe("validateArchiveAccessSession", () => {
  it("returns the session when a live row matches", async () => {
    fake.when("FROM archive_access_sessions s", () => ({
      rows: [{ id: "sess-1" }],
      rowCount: 1,
    }));
    await expect(validateArchiveAccessSession(generateAccessToken())).resolves.toEqual({
      id: "sess-1",
    });
  });

  it("returns null and issues no query for a missing token", async () => {
    await expect(validateArchiveAccessSession(null)).resolves.toBeNull();
    await expect(validateArchiveAccessSession("")).resolves.toBeNull();
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("returns null when no live row matches (expired/revoked/mismatch/disabled)", async () => {
    fake.when("FROM archive_access_sessions s", () => ({ rows: [], rowCount: 0 }));
    await expect(validateArchiveAccessSession(generateAccessToken())).resolves.toBeNull();
  });

  it("enforces every fail-closed guard in ONE statement", async () => {
    fake.when("FROM archive_access_sessions s", () => ({ rows: [], rowCount: 0 }));
    const token = generateAccessToken();
    await validateArchiveAccessSession(token);

    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    const statement = String(sql);
    expect(statement).toContain("s.token_hash = $1");
    expect(statement).toContain("s.revoked_at IS NULL");
    expect(statement).toContain("s.expires_at > now()");
    expect(statement).toContain("a.access_enabled = true");
    expect(statement).toContain("a.pin_hash IS NOT NULL");
    expect(statement).toContain("s.access_version = a.access_version");
    expect(params[0]).toBe(hashAccessToken(token));
  });

  it("fails closed with a typed error when the table is missing (42P01)", async () => {
    fake.when("FROM archive_access_sessions s", () => {
      throw undefinedTableError();
    });
    await expect(validateArchiveAccessSession(generateAccessToken())).rejects.toBeInstanceOf(
      ArchiveAccessUnavailableError,
    );
  });

  it("propagates other database errors (never treated as a valid session)", async () => {
    fake.when("FROM archive_access_sessions s", () => {
      throw new Error("db down");
    });
    await expect(validateArchiveAccessSession(generateAccessToken())).rejects.toThrow(
      "db down",
    );
  });
});

describe("revokeArchiveAccessSession", () => {
  it("marks the session revoked by hashed token", async () => {
    fake.when("UPDATE archive_access_sessions SET revoked_at", () => ({
      rows: [],
      rowCount: 1,
    }));
    const token = generateAccessToken();
    await revokeArchiveAccessSession(token);

    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("WHERE token_hash = $1 AND revoked_at IS NULL");
    expect(params).toEqual([hashAccessToken(token)]);
  });

  it("is a no-op for a missing token", async () => {
    await revokeArchiveAccessSession(null);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("propagates database errors (never swallowed)", async () => {
    fake.when("UPDATE archive_access_sessions SET revoked_at", () => {
      throw new Error("revoke failed");
    });
    await expect(revokeArchiveAccessSession(generateAccessToken())).rejects.toThrow(
      "revoke failed",
    );
  });
});

describe("cookie helpers", () => {
  it("reads the visitor token from a Cookie header", () => {
    const request = new Request("https://vanka.test/", {
      headers: { cookie: `other=x; ${ARCHIVE_ACCESS_COOKIE_NAME}=tok123; more=y` },
    });
    expect(readArchiveAccessToken(request)).toBe("tok123");
    expect(readArchiveAccessToken(new Request("https://vanka.test/"))).toBeNull();
  });

  it("sets an HttpOnly, SameSite=Lax cookie with the access TTL, and clears it", () => {
    const res = NextResponse.json({});
    setArchiveAccessCookie(res, "tok456");
    const cookie = res.cookies.get(ARCHIVE_ACCESS_COOKIE_NAME);
    expect(cookie?.value).toBe("tok456");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(ARCHIVE_ACCESS_TTL_HOURS * 60 * 60);

    clearArchiveAccessCookie(res);
    expect(res.cookies.get(ARCHIVE_ACCESS_COOKIE_NAME)?.maxAge).toBe(0);
  });
});
