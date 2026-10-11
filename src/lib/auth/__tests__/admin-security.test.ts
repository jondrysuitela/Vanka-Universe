import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  deactivateAdminAndRevokeSessions,
  setAdminPasswordHashAndRevokeSessions,
} from "@/lib/auth/admin-security";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("deactivateAdminAndRevokeSessions", () => {
  it("deactivates and revokes in ONE atomic statement", async () => {
    fake.when("WITH deactivated AS", () => ({
      rows: [{ admins_updated: 1, sessions_revoked: 3 }],
      rowCount: 1,
    }));

    const result = await deactivateAdminAndRevokeSessions("admin-1");
    expect(result).toEqual({ adminUpdated: true, sessionsRevoked: 3 });

    // Exactly one statement => single implicit transaction (atomic).
    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("UPDATE admins SET is_active = false");
    expect(String(sql)).toContain("UPDATE sessions SET revoked_at = now()");
    expect(String(sql)).toContain("admin_id = (SELECT id FROM deactivated)");
    expect(String(sql)).toContain("revoked_at IS NULL");
    expect(params).toEqual(["admin-1"]);
  });

  it("is idempotent: missing/inactive admin reports no update and no revocations", async () => {
    fake.when("WITH deactivated AS", () => ({
      rows: [{ admins_updated: 0, sessions_revoked: 0 }],
      rowCount: 1,
    }));

    const result = await deactivateAdminAndRevokeSessions("ghost");
    expect(result).toEqual({ adminUpdated: false, sessionsRevoked: 0 });
  });

  it("rejects without an admin id and issues no query", async () => {
    await expect(deactivateAdminAndRevokeSessions("")).rejects.toThrow(/adminId/);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("propagates database errors and applies nothing (single statement)", async () => {
    fake.when("WITH deactivated AS", async () => {
      throw new Error("db down");
    });

    await expect(deactivateAdminAndRevokeSessions("admin-1")).rejects.toThrow("db down");
    // One (failed) statement only: no separate deactivate-then-revoke pair that
    // could commit partially.
    expect(fake.query).toHaveBeenCalledTimes(1);
  });

  it("rejects if the driver returns no result row (never claims success)", async () => {
    fake.when("WITH deactivated AS", () => ({ rows: [], rowCount: 0 }));
    await expect(deactivateAdminAndRevokeSessions("admin-1")).rejects.toThrow(/no result row/);
  });
});

describe("setAdminPasswordHashAndRevokeSessions", () => {
  it("sets the hash and revokes all sessions in ONE atomic statement", async () => {
    fake.when("WITH updated AS", () => ({
      rows: [{ admins_updated: 1, sessions_revoked: 2 }],
      rowCount: 1,
    }));

    const result = await setAdminPasswordHashAndRevokeSessions("admin-1", "$2b$04$stored-hash");
    expect(result).toEqual({ adminUpdated: true, sessionsRevoked: 2 });

    expect(fake.query).toHaveBeenCalledTimes(1);
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(String(sql)).toContain("UPDATE admins SET password_hash = $2 WHERE id = $1");
    expect(String(sql)).toContain("UPDATE sessions SET revoked_at = now()");
    expect(String(sql)).toContain("admin_id = (SELECT id FROM updated)");
    expect(String(sql)).toContain("revoked_at IS NULL");
    expect(params).toEqual(["admin-1", "$2b$04$stored-hash"]);
  });

  it("refuses an empty hash and issues no query", async () => {
    await expect(setAdminPasswordHashAndRevokeSessions("admin-1", "")).rejects.toThrow(/empty password hash/);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("rejects without an admin id and issues no query", async () => {
    await expect(setAdminPasswordHashAndRevokeSessions("", "$2b$04$x")).rejects.toThrow(/adminId/);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("propagates database errors and applies nothing (single statement)", async () => {
    fake.when("WITH updated AS", async () => {
      throw new Error("db down");
    });

    await expect(setAdminPasswordHashAndRevokeSessions("admin-1", "$2b$04$x")).rejects.toThrow("db down");
    expect(fake.query).toHaveBeenCalledTimes(1);
  });
});
