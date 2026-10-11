import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  MAX_FAILURES_PER_EMAIL_IP,
  MAX_FAILURES_PER_IP,
  REAUTH_MAX_FAILURES_PER_ADMIN,
  isLoginLocked,
  isReauthLocked,
  recordLoginAttempt,
  recordReauthAttempt,
} from "@/lib/auth/rate-limit";

let fake: ReturnType<typeof createFakePool>;

function countHandler(emailIpCount: number, ipCount: number) {
  return (sql: string) => {
    const n = sql.includes("email = $1") ? emailIpCount : ipCount;
    return { rows: [{ n }], rowCount: 1 };
  };
}

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("isLoginLocked", () => {
  it("is not locked with zero failures", async () => {
    fake.when("SELECT count(*)", countHandler(0, 0));
    await expect(isLoginLocked("a@vanka.universe", "1.2.3.4")).resolves.toBe(false);
  });

  it("locks when email+IP failures reach the threshold", async () => {
    fake.when("SELECT count(*)", countHandler(MAX_FAILURES_PER_EMAIL_IP, 0));
    await expect(isLoginLocked("a@vanka.universe", "1.2.3.4")).resolves.toBe(true);
  });

  it("locks when per-IP failures reach the wider threshold", async () => {
    fake.when("SELECT count(*)", countHandler(0, MAX_FAILURES_PER_IP));
    await expect(isLoginLocked("a@vanka.universe", "1.2.3.4")).resolves.toBe(true);
  });

  it("does not lock below the threshold", async () => {
    fake.when("SELECT count(*)", countHandler(MAX_FAILURES_PER_EMAIL_IP - 1, 0));
    await expect(isLoginLocked("a@vanka.universe", "1.2.3.4")).resolves.toBe(false);
  });
});

describe("recordLoginAttempt", () => {
  it("deletes past failures and inserts a success row on success", async () => {
    fake.when("DELETE FROM login_attempts", () => ({ rows: [], rowCount: 3 }));
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      expect((params as unknown[])[2]).toBe(true);
      return { rows: [], rowCount: 1 };
    });
    await recordLoginAttempt("a@vanka.universe", "1.2.3.4", true);

    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM login_attempts"))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT INTO login_attempts"))).toBe(true);
  });

  it("records a failure row on failure", async () => {
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      expect((params as unknown[])[2]).toBe(false);
      return { rows: [], rowCount: 1 };
    });
    await recordLoginAttempt("a@vanka.universe", "1.2.3.4", false);
    const call = fake.query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO login_attempts"));
    expect(call).toBeDefined();
  });
});

describe("isReauthLocked", () => {
  it("reuses the login limiter when a trusted IP is present (admin+IP and IP-wide guards)", async () => {
    fake.when("SELECT count(*)", (sql: string) => {
      const n = sql.includes("email = $1") ? 4 : 0;
      return { rows: [{ n }], rowCount: 1 };
    });
    await expect(isReauthLocked("a@vanka.universe", "203.0.113.9")).resolves.toBe(false);

    fake.when("SELECT count(*)", (sql: string) => {
      const n = sql.includes("email = $1") ? MAX_FAILURES_PER_EMAIL_IP : 0;
      return { rows: [{ n }], rowCount: 1 };
    });
    await expect(isReauthLocked("a@vanka.universe", "203.0.113.9")).resolves.toBe(true);
  });

  it("locks via the IP-wide guard too when no admin+IP key reaches it", async () => {
    fake.when("SELECT count(*)", (sql: string) => {
      const n = sql.includes("ip_address = $1") ? MAX_FAILURES_PER_IP : 0;
      return { rows: [{ n }], rowCount: 1 };
    });
    await expect(isReauthLocked("b@vanka.universe", "198.51.100.7")).resolves.toBe(true);
  });

  it("uses a per-admin identity bucket (never a shared empty-IP bucket) when no trusted IP exists", async () => {
    let identityRows = 0;
    fake.when("SELECT count(*)", (sql: string, params: unknown[] | undefined) => {
      expect(String(sql)).toContain("ip_address IS NULL");
      expect((params as unknown[])[0]).toBe("a@vanka.universe");
      return { rows: [{ n: identityRows }], rowCount: 1 };
    });

    await expect(isReauthLocked("a@vanka.universe", null)).resolves.toBe(false);
    identityRows = REAUTH_MAX_FAILURES_PER_ADMIN;
    await expect(isReauthLocked("a@vanka.universe", null)).resolves.toBe(true);
  });

  it("rejects without an admin identity (no query)", async () => {
    await expect(isReauthLocked("", null)).rejects.toThrow(/adminEmail/);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("fails closed: a database error rejects instead of opening the gate", async () => {
    fake.when("SELECT count(*)", () => {
      throw new Error("db down");
    });
    await expect(isReauthLocked("a@vanka.universe", null)).rejects.toThrow("db down");
  });
});

describe("recordReauthAttempt", () => {
  it("clears ALL of the admin's failure rows and inserts a success row", async () => {
    fake.when("DELETE FROM login_attempts", (_sql, params) => {
      expect((params as unknown[])[0]).toBe("a@vanka.universe");
      return { rows: [], rowCount: 3 };
    });
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      expect((params as unknown[])[2]).toBe(true);
      return { rows: [], rowCount: 1 };
    });
    await recordReauthAttempt("a@vanka.universe", "203.0.113.9", true);

    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM login_attempts")),
    ).toBe(true);
  });

  it("stores a failure row with the trusted IP, or NULL when no IP exists", async () => {
    const seen: Array<unknown[]> = [];
    fake.when("INSERT INTO login_attempts", (_sql, params) => {
      seen.push(params as unknown[]);
      return { rows: [], rowCount: 1 };
    });

    await recordReauthAttempt("a@vanka.universe", "203.0.113.9", false);
    await recordReauthAttempt("a@vanka.universe", null, false);

    expect(seen[0][0]).toBe("a@vanka.universe");
    expect(seen[0][1]).toBe("203.0.113.9");
    expect(seen[0][2]).toBe(false);
    expect(seen[1][1]).toBeNull();
  });
});