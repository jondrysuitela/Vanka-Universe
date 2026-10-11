import { beforeEach, describe, expect, it } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";
import {
  deleteMediaObjectRow,
  insertPendingMediaObject,
  listMediaObjectsByStatus,
  markMediaObjectReady,
  reinsertMediaObjectRow,
  rowToRecord,
  selectAnyMediaObject,
  selectReadyMediaObject,
  updateReadyMediaObjectMetadata,
  type MediaObjectRow,
} from "@/lib/media/db/repository";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";

function rowsResult(rows: unknown[]): FakeResult {
  return { rows: rows as Record<string, unknown>[], rowCount: rows.length };
}

const row: MediaObjectRow = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  storage_provider: "r2",
  storage_key: "test/11111111-1111-4111-8111-111111111111.png",
  mime_type: "image/png",
  kind: "image",
  file_size: 3,
  display_name: "foto.png",
  owner_id: "admin-1",
  owner_label: "Owner",
  created_at: "2026-01-01T00:00:00.000Z",
  title: null,
  description: null,
  taken_at: null,
  updated_at: "2026-01-01T00:00:00.000Z",
};

const undefinedTable = () => {
  throw Object.assign(new Error('relation "media_objects" does not exist'), { code: "42P01" });
};

type Fake = ReturnType<typeof createFakePool>;
let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
});

describe("rowToRecord", () => {
  it("maps DB columns to the existing MediaRecord shape", () => {
    expect(rowToRecord(row)).toEqual({
      id: row.id,
      name: "foto.png",
      mime: "image/png",
      kind: "image",
      size: 3,
      ownerId: "admin-1",
      ownerLabel: "Owner",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: null,
      description: null,
      takenAt: null,
    });
  });
});

describe("insertPendingMediaObject", () => {
  it("sends a parameterized pending insert and never interpolates values", async () => {
    fake.when("INSERT INTO media_objects", () => rowsResult([row]));
    const result = await insertPendingMediaObject(fake.pool, {
      id: row.id,
      storageProvider: "r2",
      storageKey: row.storage_key,
      mime: "image/png",
      kind: "image",
      size: 3,
      displayName: "foto.png",
      ownerId: "admin-1",
      ownerLabel: "Owner",
    });
    expect(result).toEqual(row);

    const call = fake.query.mock.calls[0];
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("INSERT INTO media_objects");
    expect(sql).toContain("'pending'");
    expect(sql).not.toContain("foto.png");
    expect(params).toEqual([
      row.id,
      "r2",
      row.storage_key,
      "image/png",
      "image",
      3,
      "foto.png",
      "admin-1",
      "Owner",
    ]);
  });

  it("fails closed when the table is missing", async () => {
    fake.when("INSERT INTO media_objects", undefinedTable);
    await expect(
      insertPendingMediaObject(fake.pool, {
        id: row.id,
        storageProvider: "r2",
        storageKey: row.storage_key,
        mime: "image/png",
        kind: "image",
        size: 3,
        displayName: "foto.png",
        ownerId: null,
        ownerLabel: null,
      }),
    ).rejects.toBeInstanceOf(MediaObjectsUnavailableError);
  });
});

describe("markMediaObjectReady", () => {
  it("only targets the given id and returns the row", async () => {
    fake.when("SET status = 'ready'", () => rowsResult([{ ...row, status: "ready" }]));
    const ready = await markMediaObjectReady(fake.pool, row.id);
    expect(ready).toMatchObject({ id: row.id, status: "ready" });
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE media_objects");
    expect(params).toEqual([row.id]);
  });

  it("returns null when nothing matched", async () => {
    fake.when("SET status = 'ready'", () => rowsResult([]));
    expect(await markMediaObjectReady(fake.pool, row.id)).toBeNull();
  });
});

describe("selectors", () => {
  it("lists by status with a parameter", async () => {
    fake.when("WHERE status = $1", () => rowsResult([{ ...row, status: "ready" }]));
    const rows = await listMediaObjectsByStatus(fake.pool, "ready");
    expect(rows).toHaveLength(1);
    expect(fake.query.mock.calls[0]?.[1]).toEqual(["ready"]);
  });

  it("selects ready rows only", async () => {
    fake.when("WHERE id = $1 AND status = 'ready'", () => rowsResult([{ ...row, status: "ready" }]));
    const found = await selectReadyMediaObject(fake.pool, row.id);
    expect(found).toMatchObject({ status: "ready" });
  });

  it("selects any status for lifecycle", async () => {
    fake.when("WHERE id = $1", () => rowsResult([row]));
    expect(await selectAnyMediaObject(fake.pool, row.id)).toMatchObject({ status: "pending" });
  });
});

describe("updateReadyMediaObjectMetadata", () => {
  it("builds a parameterized SET and returns the row", async () => {
    fake.when("SET", () => rowsResult([{ ...row, status: "ready", title: "Hai" }]));
    const updated = await updateReadyMediaObjectMetadata(fake.pool, row.id, { title: "Hai" });
    expect(updated).toMatchObject({ title: "Hai" });
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("title = $1");
    expect(sql).toContain("status = 'ready'");
    expect(params).toEqual(["Hai", row.id]);
  });

  it("returns the row unchanged for an empty patch", async () => {
    fake.when("WHERE id = $1 AND status = 'ready'", () => rowsResult([{ ...row, status: "ready" }]));
    const result = await updateReadyMediaObjectMetadata(fake.pool, row.id, {});
    expect(result).toMatchObject({ id: row.id });
    expect(fake.query.mock.calls[0][0]).toContain("SELECT");
  });
});

describe("delete and reinsert", () => {
  it("deletes by id and returns the row", async () => {
    fake.when("DELETE FROM media_objects", () => rowsResult([row]));
    expect(await deleteMediaObjectRow(fake.pool, row.id)).toMatchObject({ id: row.id });
    expect(fake.query.mock.calls[0]?.[1]).toEqual([row.id]);
  });

  it("reinserts idempotently with ON CONFLICT DO NOTHING", async () => {
    fake.when("ON CONFLICT (id) DO NOTHING", () => rowsResult([row]));
    const restored = await reinsertMediaObjectRow(fake.pool, row);
    expect(restored).toMatchObject({ id: row.id });
    const [sql, params] = fake.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO media_objects");
    expect(sql).toContain("ON CONFLICT (id) DO NOTHING");
    expect(params).toEqual([
      row.id,
      row.status,
      row.storage_provider,
      row.storage_key,
      row.mime_type,
      row.kind,
      row.file_size,
      row.display_name,
      row.owner_id,
      row.owner_label,
      row.created_at,
      row.title,
      row.description,
      row.taken_at,
    ]);
  });

  it("selects any row by id", async () => {
    fake.when("WHERE id = $1", () => rowsResult([row]));
    expect(await selectAnyMediaObject(fake.pool, row.id)).toMatchObject({ id: row.id });
  });
});
