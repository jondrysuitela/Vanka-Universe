import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SessionAdmin } from "@/lib/auth/session";
import type { DbPool } from "@/lib/db";
import { MediaMetadataIntegrityError } from "@/lib/media/db/errors";
import { listMediaObjectsByStatus, type MediaObjectRow } from "@/lib/media/db/repository";
import type { MediaCollection } from "@/lib/media/storage/types";
import { createDbMediaStore } from "@/lib/media/storage/db-media-store";
import type { MediaObjectClient } from "@/lib/media/storage/object-client";

const admin = { id: "admin-1", name: "Owner" } as unknown as SessionAdmin;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x09]);

function pngFile(name = "foto.png"): File {
  return new File([new Uint8Array(PNG)], name, { type: "image/png" });
}

type Row = MediaObjectRow;

function createMemoryPool() {
  const rows = new Map<string, Row>();
  let failMarkReady = false;
  let failDeleteRow = false;

  const pool: DbPool = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (sql.includes("'pending'") && sql.includes("INSERT INTO media_objects")) {
        const created: Row = {
          id: String(params[0]),
          status: "pending",
          storage_provider: String(params[1]),
          storage_key: String(params[2]),
          mime_type: String(params[3]),
          kind: String(params[4]) as Row["kind"],
          file_size: Number(params[5]),
          display_name: String(params[6]),
          owner_id: (params[7] as string | null) ?? null,
          owner_label: (params[8] as string | null) ?? null,
          created_at: new Date(2026, 0, 1, 0, 0, rows.size).toISOString(),
          collection: (params[9] as MediaCollection) ?? "birthday",
          title: null,
          description: null,
          taken_at: null,
          updated_at: new Date(2026, 0, 1, 0, 0, rows.size).toISOString(),
        };
        rows.set(created.id, created);
        return { rows: [{ ...created } as T] };
      }

      if (sql.includes("ON CONFLICT (id) DO NOTHING")) {
        const id = String(params[0]);
        if (rows.has(id)) return { rows: [] };
        const restored: Row = {
          id,
          status: String(params[1]) as Row["status"],
          storage_provider: String(params[2]),
          storage_key: String(params[3]),
          mime_type: String(params[4]),
          kind: String(params[5]) as Row["kind"],
          file_size: Number(params[6]),
          display_name: String(params[7]),
          owner_id: (params[8] as string | null) ?? null,
          owner_label: (params[9] as string | null) ?? null,
          created_at: String(params[10]),
          title: (params[11] as string | null) ?? null,
          description: (params[12] as string | null) ?? null,
          taken_at: (params[13] as string | null) ?? null,
          collection: (params[14] as MediaCollection) ?? "birthday",
          updated_at: String(params[10]),
        };
        rows.set(id, restored);
        return { rows: [{ ...restored } as T] };
      }

      if (sql.includes("SET status = 'ready'")) {
        if (failMarkReady) throw new Error("mark ready failed");
        const r = rows.get(String(params[0]));
        if (!r) return { rows: [] };
        r.status = "ready";
        return { rows: [{ ...r } as T] };
      }

      if (sql.includes("UPDATE media_objects")) {
        const r = rows.get(String(params[params.length - 1]));
        if (!r || r.status !== "ready") return { rows: [] };
        for (const match of sql.matchAll(/(\w+) = \$(\d+)/g)) {
          (r as unknown as Record<string, unknown>)[match[1]] = params[Number(match[2]) - 1];
        }
        return { rows: [{ ...r } as T] };
      }

      if (sql.includes("DELETE FROM media_objects")) {
        if (failDeleteRow) throw new Error("delete row failed");
        const r = rows.get(String(params[0]));
        if (r) rows.delete(r.id);
        return { rows: (r ? [{ ...r }] : []) as T[] };
      }

      if (sql.includes("WHERE status = $1")) {
        const status = String(params[0]);
        return {
          rows: [...rows.values()]
            .filter((r) => r.status === status)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
            .map((r) => ({ ...r })) as T[],
        };
      }

      if (sql.includes("status = 'ready'")) {
        const r = rows.get(String(params[0]));
        return { rows: (r && r.status === "ready" ? [{ ...r }] : []) as T[] };
      }

      if (sql.includes("WHERE id = $1")) {
        const r = rows.get(String(params[0]));
        return { rows: (r ? [{ ...r }] : []) as T[] };
      }

      throw new Error(`unexpected SQL in fake pool: ${sql.slice(0, 80)}`);
    },
  };

  return {
    pool,
    rows,
    setFailMarkReady(value: boolean) {
      failMarkReady = value;
    },
    setFailDeleteRow(value: boolean) {
      failDeleteRow = value;
    },
  };
}

function createMemoryObjects() {
  const map = new Map<string, Buffer>();
  let failPut: ((key: string) => Error | null) | null = null;
  let failDelete: ((key: string) => Error | null) | null = null;

  const objects: MediaObjectClient = {
    async put(key, bytes) {
      const injected = failPut?.(key) ?? null;
      if (injected) throw injected;
      map.set(key, Buffer.from(bytes));
    },
    async get(key) {
      return map.has(key) ? Buffer.from(map.get(key)!) : null;
    },
    async exists(key) {
      return map.has(key);
    },
    async delete(key) {
      const injected = failDelete?.(key) ?? null;
      if (injected) throw injected;
      map.delete(key);
    },
  };

  return {
    objects,
    map,
    setFailPut(fn: ((key: string) => Error | null) | null) {
      failPut = fn;
    },
    setFailDelete(fn: ((key: string) => Error | null) | null) {
      failDelete = fn;
    },
  };
}

function makeStore() {
  const db = createMemoryPool();
  const obj = createMemoryObjects();
  const store = createDbMediaStore({ pool: db.pool, objects: obj.objects });
  return { db, obj, store };
}

describe("createDbMediaStore — upload lifecycle", () => {
  it("writes pending, uploads the object, then flips to ready", async () => {
    const { db, obj, store } = makeStore();
    const record = await store.save(admin, pngFile());

    expect(record.kind).toBe("image");
    expect(record.mime).toBe("image/png");
    expect(record.title).toBeNull();

    const storedRow = db.rows.get(record.id);
    expect(storedRow?.status).toBe("ready");
    expect(storedRow?.file_size).toBe(PNG.byteLength);
    expect(obj.map.has(`test/${record.id}.png`)).toBe(true);
  });

  it("keeps a pending row hidden from list/find until ready", async () => {
    const { db, store } = makeStore();
    const row: Row = {
      id: "99999999-9999-4999-8999-999999999999",
      status: "pending",
      storage_provider: "r2",
      storage_key: "test/99999999-9999-4999-8999-999999999999.png",
      mime_type: "image/png",
      kind: "image",
      file_size: 4,
      display_name: "x.png",
      owner_id: "admin-1",
      owner_label: "Owner",
      created_at: "2026-01-01T00:00:00.000Z",
      collection: "birthday",
      title: null,
      description: null,
      taken_at: null,
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    db.rows.set(row.id, row);

    expect(await store.list()).toEqual([]);
    expect(await store.find(row.id)).toBeNull();
    expect(await store.read(row.id)).toBeNull();

    // Still observable to an operator for reconciliation.
    const pending = await listMediaObjectsByStatus(db.pool, "pending");
    expect(pending.map((r) => r.id)).toEqual([row.id]);
  });

  it("compensates a failed object upload by deleting the pending row", async () => {
    const { db, obj, store } = makeStore();
    obj.setFailPut(() => new Error("r2 unavailable"));

    await expect(store.save(admin, pngFile())).rejects.toThrow("r2 unavailable");
    expect(db.rows.size).toBe(0);
    expect(obj.map.size).toBe(0);
  });

  it("surfaces an integrity error when upload AND row cleanup both fail", async () => {
    const { obj, store, db } = makeStore();
    obj.setFailPut(() => new Error("r2 unavailable"));
    db.setFailDeleteRow(true);

    await expect(store.save(admin, pngFile())).rejects.toBeInstanceOf(MediaMetadataIntegrityError);
  });

  it("compensates a failed mark-ready by removing the object and the row", async () => {
    const { db, obj, store } = makeStore();
    db.setFailMarkReady(true);

    await expect(store.save(admin, pngFile())).rejects.toThrow("mark ready failed");
    expect(db.rows.size).toBe(0);
    expect(obj.map.size).toBe(0);
  });

  it("leaves a pending row when mark-ready compensation also fails", async () => {
    const { db, obj, store } = makeStore();
    db.setFailMarkReady(true);
    obj.setFailDelete(() => new Error("delete unavailable"));
    db.setFailDeleteRow(true);

    await expect(store.save(admin, pngFile())).rejects.toBeInstanceOf(MediaMetadataIntegrityError);
    // The half-finished row is visible to ops, never to users.
    expect(db.rows.size).toBe(1);
    expect((await listMediaObjectsByStatus(db.pool, "pending")).length).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  it("still removes the row when only the object cleanup fails", async () => {
    const { db, obj, store } = makeStore();
    db.setFailMarkReady(true);
    obj.setFailDelete(() => new Error("delete unavailable"));

    await expect(store.save(admin, pngFile())).rejects.toBeInstanceOf(MediaMetadataIntegrityError);
    // Row was cleaned but the object delete failed: bytes may remain, flagged loudly.
    expect(db.rows.size).toBe(0);
    expect(obj.map.size).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  it("rejects an unsupported file before touching R2 or the database", async () => {
    const { db, obj, store } = makeStore();
    const text = new File([new Uint8Array([0x68, 0x69, 0x21])], "notes.txt", { type: "text/plain" });
    await expect(store.save(admin, text)).rejects.toMatchObject({ status: 415 });
    expect(db.rows.size).toBe(0);
    expect(obj.map.size).toBe(0);
  });

  it("stores two concurrent uploads independently (no shared read-modify-write)", async () => {
    const { db, obj, store } = makeStore();
    const [a, b] = await Promise.all([store.save(admin, pngFile("a.png")), store.save(admin, pngFile("b.png"))]);

    expect(a.id).not.toBe(b.id);
    expect(db.rows.size).toBe(2);
    expect(obj.map.size).toBe(2);
    expect((await store.list()).length).toBe(2);
  });
});

describe("createDbMediaStore — read and metadata", () => {
  it("lists, finds, and reads ready media", async () => {
    const { store } = makeStore();
    const record = await store.save(admin, pngFile());

    expect((await store.list()).map((r) => r.id)).toEqual([record.id]);
    expect(await store.find(record.id)).toMatchObject({ id: record.id });

    const read = await store.read(record.id);
    expect(read?.record.id).toBe(record.id);
    expect(Buffer.from(read!.data).equals(PNG)).toBe(true);
    // Range-compatible: the route slices this buffer.
    expect(Buffer.from(read!.data).subarray(0, 4).equals(PNG.subarray(0, 4))).toBe(true);
  });

  it("returns null when the catalogued object is missing", async () => {
    const { obj, store } = makeStore();
    const record = await store.save(admin, pngFile());
    obj.map.delete(`test/${record.id}.png`);

    expect(await store.read(record.id)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it("updates metadata on the ready row", async () => {
    const { store } = makeStore();
    const record = await store.save(admin, pngFile());
    const updated = await store.updateMetadata(record.id, { title: "Hai", takenAt: "2020-01-01" });
    expect(updated).toMatchObject({ title: "Hai", takenAt: "2020-01-01" });
    expect(await store.find(record.id)).toMatchObject({ title: "Hai" });
  });
});

describe("createDbMediaStore — delete lifecycle", () => {
  it("deletes the metadata row and the object", async () => {
    const { db, obj, store } = makeStore();
    const record = await store.save(admin, pngFile());

    await expect(store.remove(record.id)).resolves.toMatchObject({ id: record.id });
    expect(db.rows.size).toBe(0);
    expect(obj.map.size).toBe(0);
  });

  it("restores the row when object deletion fails", async () => {
    const { db, obj, store } = makeStore();
    const record = await store.save(admin, pngFile());
    obj.setFailDelete(() => new Error("bucket error"));

    await expect(store.remove(record.id)).rejects.toThrow("bucket error");
    expect(db.rows.get(record.id)?.status).toBe("ready");
    expect((await store.list()).length).toBe(1);
  });

  it("treats an already-missing object as a successful delete (idempotent)", async () => {
    const { db, obj, store } = makeStore();
    const record = await store.save(admin, pngFile());
    obj.map.delete(`test/${record.id}.png`);

    await expect(store.remove(record.id)).resolves.toMatchObject({ id: record.id });
    expect(db.rows.size).toBe(0);
  });
});

describe("key isolation", () => {
  it("uses the configured prefix and never returns the storage key", async () => {
    const { db, obj } = makeStore();
    const db2 = db;
    const custom = createDbMediaStore({
      pool: db2.pool,
      objects: obj.objects,
      keyPrefix: "arsip/",
    });
    const record = await custom.save(admin, pngFile());

    expect(obj.map.has(`arsip/${record.id}.png`)).toBe(true);
    expect([...obj.map.keys()].every((k) => k.startsWith("arsip/"))).toBe(true);
    expect(db2.rows.get(record.id)?.storage_key).toBe(`arsip/${record.id}.png`);
    expect(JSON.stringify(record)).not.toContain("arsip/");
    expect(record).not.toHaveProperty("storageKey");
  });
});
