import { beforeEach, describe, expect, it } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";
import type { MediaObjectRow } from "@/lib/media/db/repository";
import {
  DEFAULT_PENDING_MAX_AGE_MS,
  reconcilePendingMediaObjects,
} from "@/lib/media/db/reconcile";
import type { MediaObjectClient } from "@/lib/media/storage/object-client";

const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const OLD = new Date(NOW - DEFAULT_PENDING_MAX_AGE_MS - 1000).toISOString();
const YOUNG = new Date(NOW - 1000).toISOString();

const ID_OLD = "11111111-1111-4111-8111-111111111111";
const ID_OLD2 = "22222222-2222-4222-8222-222222222222";
const ID_YOUNG = "33333333-3333-4333-8333-333333333333";

function rowFor(id: string, createdAt: string): MediaObjectRow {
  return {
    id,
    status: "pending",
    storage_provider: "r2",
    storage_key: `test/${id}.png`,
    mime_type: "image/png",
    kind: "image",
    file_size: 3,
    display_name: "foto.png",
    owner_id: "admin-1",
    owner_label: "Owner",
    created_at: createdAt,
    title: null,
    description: null,
    taken_at: null,
    updated_at: createdAt,
  };
}

function asResult(rows: unknown[]): FakeResult {
  return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
}

function createObjects(presentKeys: string[]) {
  const present = new Set(presentKeys);
  const existsCalls: string[] = [];
  const deleteCalls: string[] = [];

  const objects: MediaObjectClient = {
    put: async () => {},
    get: async () => null,
    exists: async (key) => {
      existsCalls.push(key);
      return present.has(key);
    },
    delete: async (key) => {
      deleteCalls.push(key);
    },
  };

  return { objects, existsCalls, deleteCalls };
}

type Fake = ReturnType<typeof createFakePool>;
let fake: Fake;
let rows: MediaObjectRow[];
let writes: string[];

beforeEach(() => {
  fake = createFakePool();
  rows = [];
  writes = [];

  fake.when("WHERE status = $1", (_sql, params) => {
    const status = String(params?.[0]);
    const matched = rows.filter((r) => r.status === status);
    return asResult(matched);
  });
  fake.when("SET status = 'ready'", (_sql, params) => {
    writes.push("mark-ready");
    const row = rows.find((r) => r.id === String(params?.[0]));
    if (!row) return asResult([]);
    row.status = "ready";
    return asResult([{ ...row }]);
  });
  fake.when("DELETE FROM media_objects", (_sql, params) => {
    writes.push("delete-row");
    const index = rows.findIndex((r) => r.id === String(params?.[0]));
    if (index === -1) return asResult([]);
    const [removed] = rows.splice(index, 1);
    return asResult([{ ...removed }]);
  });
});

describe("reconcilePendingMediaObjects", () => {
  it("is dry-run by default and performs no writes", async () => {
    rows = [rowFor(ID_OLD, OLD)];
    const { objects } = createObjects([`test/${ID_OLD}.png`]);

    const report = await reconcilePendingMediaObjects({ pool: fake.pool, objects, now: NOW });

    expect(report.dryRun).toBe(true);
    expect(report.scanned).toBe(1);
    expect(report.markedReady).toBe(1);
    expect(writes).toEqual([]);
    expect(report.findings[0]).toMatchObject({ id: ID_OLD, action: "mark-ready" });
  });

  it("classifies a missing object as delete-row AND a present object as mark-ready", async () => {
    rows = [rowFor(ID_OLD, OLD), rowFor(ID_OLD2, OLD)];
    const { objects, deleteCalls } = createObjects([`test/${ID_OLD}.png`]);

    const report = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      dryRun: false,
    });

    expect(report.markedReady).toBe(1);
    expect(report.deletedRows).toBe(1);
    // Only metadata rows were removed; the object client never deleted a byte.
    expect(deleteCalls).toEqual([]);
    expect(writes).toEqual(["mark-ready", "delete-row"]);
    const byId = Object.fromEntries(report.findings.map((f) => [f.id, f.action]));
    expect(byId[ID_OLD]).toBe("mark-ready");
    expect(byId[ID_OLD2]).toBe("delete-row");
  });

  it("skips young rows without probing the object", async () => {
    rows = [rowFor(ID_YOUNG, YOUNG)];
    const { objects, existsCalls } = createObjects([`test/${ID_YOUNG}.png`]);

    const report = await reconcilePendingMediaObjects({ pool: fake.pool, objects, now: NOW });

    expect(report.skipped).toBe(1);
    expect(report.findings[0]).toMatchObject({ id: ID_YOUNG, action: "skip", reason: "too-young" });
    expect(existsCalls).toEqual([]);
  });

  it("skips rows with an unparseable created_at", async () => {
    rows = [rowFor(ID_OLD, "not-a-date")];
    const { objects, existsCalls } = createObjects([]);

    const report = await reconcilePendingMediaObjects({ pool: fake.pool, objects, now: NOW });

    expect(report.skipped).toBe(1);
    expect(report.findings[0]).toMatchObject({ reason: "unparseable-created-at" });
    expect(existsCalls).toEqual([]);
  });

  it("honours the limit", async () => {
    rows = [
      rowFor(ID_OLD, OLD),
      rowFor(ID_OLD2, OLD),
      rowFor(ID_YOUNG, OLD),
    ];
    const { objects } = createObjects([]);

    const report = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      limit: 2,
    });

    expect(report.scanned).toBe(2);
  });

  it("records a per-row apply failure as skip and keeps going", async () => {
    rows = [rowFor(ID_OLD, OLD), rowFor(ID_OLD2, OLD)];
    const { objects } = createObjects([`test/${ID_OLD}.png`, `test/${ID_OLD2}.png`]);

    fake.when("SET status = 'ready'", () => {
      writes.push("mark-ready");
      throw new Error("db down");
    });

    const report = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      dryRun: false,
    });

    expect(report.skipped).toBe(2);
    expect(report.findings.every((f) => f.reason === "apply-failed")).toBe(true);
  });

  it("is idempotent: a second run over already-processed rows does nothing", async () => {
    rows = [rowFor(ID_OLD, OLD), rowFor(ID_OLD2, OLD)];
    const { objects } = createObjects([`test/${ID_OLD}.png`]);

    const first = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      dryRun: false,
    });
    expect(first.scanned).toBe(2);

    const second = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      dryRun: false,
    });
    expect(second.scanned).toBe(0);
    expect(second.markedReady).toBe(0);
    expect(second.deletedRows).toBe(0);
  });

  it("respects a custom age bound", async () => {
    rows = [rowFor(ID_OLD, OLD)];
    const { objects } = createObjects([`test/${ID_OLD}.png`]);
    const hugeAge = DEFAULT_PENDING_MAX_AGE_MS * 10;

    const report = await reconcilePendingMediaObjects({
      pool: fake.pool,
      objects,
      now: NOW,
      maxAgeMs: hugeAge,
    });

    expect(report.skipped).toBe(1);
    expect(report.findings[0]).toMatchObject({ reason: "too-young" });
  });
});
