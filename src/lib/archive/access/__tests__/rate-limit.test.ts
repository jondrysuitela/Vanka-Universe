import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  isArchiveAccessLocked,
  recordArchiveAccessAttempt,
} from "@/lib/archive/access/rate-limit";
import {
  ArchiveAccessIdentityError,
  ArchiveAccessUnavailableError,
} from "@/lib/archive/access/errors";
import {
  ARCHIVE_MAX_FAILURES_GLOBAL,
  ARCHIVE_MAX_FAILURES_PER_IP,
} from "@/lib/archive/access/policy";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

/** Per-IP query filters on `ip_address = $1`; the global query does not. */
function countHandler(perIp: number, global: number) {
  return (sql: string) => {
    const n = sql.includes("ip_address = $1") ? perIp : global;
    return { rows: [{ n }], rowCount: 1 };
  };
}

describe("isArchiveAccessLocked", () => {
  it("is not locked with zero failures", async () => {
    fake.when("SELECT count(*)", countHandler(0, 0));
    await expect(isArchiveAccessLocked("1.2.3.4")).resolves.toBe(false);
  });

  it("locks when per-IP failures reach the threshold", async () => {
    fake.when("SELECT count(*)", countHandler(ARCHIVE_MAX_FAILURES_PER_IP, 0));
    await expect(isArchiveAccessLocked("1.2.3.4")).resolves.toBe(true);
  });

  it("locks when the GLOBAL brake is tripped (distributed attempt)", async () => {
    fake.when("SELECT count(*)", countHandler(0, ARCHIVE_MAX_FAILURES_GLOBAL));
    await expect(isArchiveAccessLocked("1.2.3.4")).resolves.toBe(true);
  });

  it("does not lock below either threshold", async () => {
    fake.when(
      "SELECT count(*)",
      countHandler(ARCHIVE_MAX_FAILURES_PER_IP - 1, ARCHIVE_MAX_FAILURES_GLOBAL - 1),
    );
    await expect(isArchiveAccessLocked("1.2.3.4")).resolves.toBe(false);
  });

  it("keeps the global threshold far above the per-IP one (one IP cannot lock the archive)", () => {
    expect(ARCHIVE_MAX_FAILURES_GLOBAL).toBeGreaterThan(ARCHIVE_MAX_FAILURES_PER_IP);
  });

  it("issues one per-IP count and one global count", async () => {
    fake.when("SELECT count(*)", countHandler(0, 0));
    await isArchiveAccessLocked("1.2.3.4");
    expect(fake.query).toHaveBeenCalledTimes(2);
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((s) => s.includes("ip_address = $1"))).toBe(true);
    expect(statements.some((s) => !s.includes("ip_address"))).toBe(true);
  });

  it("fails closed with a typed error when the table is missing (42P01)", async () => {
    fake.when("SELECT count(*)", () => {
      const error = new Error("relation does not exist") as Error & { code: string };
      error.code = "42P01";
      throw error;
    });
    await expect(isArchiveAccessLocked("1.2.3.4")).rejects.toBeInstanceOf(
      ArchiveAccessUnavailableError,
    );
  });

  it("rejects an empty IP with a typed identity error and issues no query (no shared bucket)", async () => {
    await expect(isArchiveAccessLocked("")).rejects.toBeInstanceOf(ArchiveAccessIdentityError);
    expect(fake.query).not.toHaveBeenCalled();
  });
});

describe("recordArchiveAccessAttempt", () => {
  it("clears past failures and appends a success row on success", async () => {
    fake.when("DELETE FROM archive_access_attempts", () => ({ rows: [], rowCount: 3 }));
    fake.when("INSERT INTO archive_access_attempts", (_sql, params) => {
      expect((params as unknown[])[1]).toBe(true);
      return { rows: [], rowCount: 1 };
    });
    await recordArchiveAccessAttempt("1.2.3.4", true);

    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM archive_access_attempts"),
      ),
    ).toBe(true);
    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).startsWith("INSERT INTO archive_access_attempts"),
      ),
    ).toBe(true);
  });

  it("appends a failure row and does not clear on failure", async () => {
    fake.when("INSERT INTO archive_access_attempts", (_sql, params) => {
      expect((params as unknown[])[1]).toBe(false);
      return { rows: [], rowCount: 1 };
    });
    await recordArchiveAccessAttempt("1.2.3.4", false);

    expect(fake.query).toHaveBeenCalledTimes(1);
    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM archive_access_attempts"),
      ),
    ).toBe(false);
  });

  it("fails closed with a typed error when the table is missing (42P01)", async () => {
    fake.when("INSERT INTO archive_access_attempts", () => {
      const error = new Error("relation does not exist") as Error & { code: string };
      error.code = "42P01";
      throw error;
    });
    await expect(recordArchiveAccessAttempt("1.2.3.4", false)).rejects.toBeInstanceOf(
      ArchiveAccessUnavailableError,
    );
  });

  it("rejects an empty IP with a typed identity error and issues no query", async () => {
    await expect(recordArchiveAccessAttempt("", false)).rejects.toBeInstanceOf(
      ArchiveAccessIdentityError,
    );
    expect(fake.query).not.toHaveBeenCalled();
  });
});
