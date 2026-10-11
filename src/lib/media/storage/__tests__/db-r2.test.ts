import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getPoolMock } = vi.hoisted(() => ({
  getPoolMock: vi.fn((): never => {
    throw new Error("DB_DRIVER is not configured");
  }),
}));

vi.mock("@/lib/db", () => ({
  getPool: () => getPoolMock(),
}));

import type { SessionAdmin } from "@/lib/auth/session";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import type { MediaObjectRow } from "@/lib/media/db/repository";
import { createDbR2MediaStore } from "@/lib/media/storage/db-r2";
import { describeMediaStoreError } from "@/lib/media/storage/error-mapping";
import { R2ConfigError, type R2Config } from "@/lib/media/storage/r2";
import { StorageConfigError } from "@/lib/media/storage/types";

/**
 * 4G.40D-4 — `db-r2` provider wiring. No database and no network are contacted:
 * the pool is an in-memory double and the S3 surface is a fake that records the
 * commands it receives. Credentials are never read (config is injected).
 */

const admin = { id: "admin-1", name: "Owner" } as unknown as SessionAdmin;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x09]);

function pngFile(name = "foto.png"): File {
  return new File([new Uint8Array(PNG)], name, { type: "image/png" });
}

const BASE_CONFIG: R2Config = {
  accountId: "acct",
  accessKeyId: "key-id",
  secretAccessKey: "secret-value",
  bucket: "vanka-universe-test",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  keyPrefix: "test/",
  metadataKey: "test/index.json",
};

interface SentCommand {
  name: string;
  input: { Bucket?: string; Key?: string; Body?: unknown; ContentType?: string };
}

function notFound(): Error {
  const error = new Error("not found");
  error.name = "NoSuchKey";
  return error;
}

function createFakeS3() {
  const objects = new Map<string, Buffer>();
  const sent: SentCommand[] = [];
  let failPut = false;

  const client = {
    async send(command: unknown): Promise<unknown> {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: SentCommand["input"] }).input;
      sent.push({ name, input });

      if (name === "PutObjectCommand") {
        if (failPut) throw new Error("r2 unavailable");
        objects.set(String(input.Key), Buffer.from(input.Body as Buffer));
        return {};
      }
      if (name === "GetObjectCommand") {
        if (!objects.has(String(input.Key))) throw notFound();
        const buf = objects.get(String(input.Key))!;
        return { Body: { transformToByteArray: async () => new Uint8Array(buf) } };
      }
      if (name === "HeadObjectCommand") {
        if (!objects.has(String(input.Key))) throw notFound();
        return {};
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(String(input.Key));
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  };

  return {
    client,
    objects,
    sent,
    setFailPut(value: boolean) {
      failPut = value;
    },
  };
}

function createMemoryPool() {
  const rows = new Map<string, MediaObjectRow>();
  let failWith: unknown = null;

  const pool = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (failWith) throw failWith;

      if (sql.includes("INSERT INTO media_objects") && !sql.includes("ON CONFLICT")) {
        const created: MediaObjectRow = {
          id: String(params[0]),
          status: "pending",
          storage_provider: String(params[1]),
          storage_key: String(params[2]),
          mime_type: String(params[3]),
          kind: String(params[4]) as MediaObjectRow["kind"],
          file_size: Number(params[5]),
          display_name: String(params[6]),
          owner_id: (params[7] as string | null) ?? null,
          owner_label: (params[8] as string | null) ?? null,
          created_at: "2026-01-01T00:00:00.000Z",
          title: null,
          description: null,
          taken_at: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        };
        rows.set(created.id, created);
        return { rows: [{ ...created } as T] };
      }

      if (sql.includes("SET status = 'ready'")) {
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
        const r = rows.get(String(params[0]));
        if (r) rows.delete(r.id);
        return { rows: (r ? [{ ...r }] : []) as T[] };
      }

      if (sql.includes("WHERE status = $1")) {
        const status = String(params[0]);
        return {
          rows: [...rows.values()].filter((r) => r.status === status).map((r) => ({ ...r })) as T[],
        };
      }

      if (sql.includes("status = 'ready'")) {
        const r = rows.get(String(params[0]));
        return { rows: (r && r.status === "ready" ? [{ ...r }] : []) as T[] };
      }

      throw new Error(`unexpected SQL in fake pool: ${sql.slice(0, 80)}`);
    },
  };

  return {
    pool,
    rows,
    failWith(error: unknown) {
      failWith = error;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getPoolMock.mockImplementation((): never => {
    throw new Error("DB_DRIVER is not configured");
  });
});

describe("createDbR2MediaStore — fail-closed configuration", () => {
  it("throws R2ConfigError when R2 configuration is absent, without touching the DB", () => {
    expect(() => createDbR2MediaStore({ env: {} })).toThrow(R2ConfigError);
    expect(getPoolMock).not.toHaveBeenCalled();
  });

  it("throws StorageConfigError when the database is not configured", () => {
    expect(() => createDbR2MediaStore({ config: BASE_CONFIG })).toThrow(StorageConfigError);
  });

  it("rejects a malformed keyPrefix instead of silently using a different one", () => {
    const bad: R2Config = { ...BASE_CONFIG, keyPrefix: "test" };
    expect(() => createDbR2MediaStore({ config: bad, pool: createMemoryPool().pool })).toThrow(
      StorageConfigError,
    );
  });
});

describe("createDbR2MediaStore — key prefix consistency", () => {
  it("forwards R2_KEY_PREFIX to both the object client and the metadata row", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({
      env: {
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "key-id",
        R2_SECRET_ACCESS_KEY: "secret-value",
        R2_BUCKET: "vanka-universe-test",
        R2_KEY_PREFIX: "arsip/",
      },
      pool: db.pool,
      client: s3.client,
    });

    const record = await store.save(admin, pngFile());
    const key = `arsip/${record.id}.png`;

    const put = s3.sent.find((c) => c.name === "PutObjectCommand");
    expect(put?.input.Bucket).toBe("vanka-universe-test");
    expect(put?.input.Key).toBe(key);
    expect(put?.input.ContentType).toBe("image/png");

    expect(db.rows.get(record.id)?.storage_key).toBe(key);
    expect([...s3.objects.keys()]).toEqual([key]);
    // The key never leaves the server through the public record.
    expect(JSON.stringify(record)).not.toContain("arsip/");
  });

  it("uses the normalized default prefix consistently when R2_KEY_PREFIX is unset", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({
      env: {
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "key-id",
        R2_SECRET_ACCESS_KEY: "secret-value",
        R2_BUCKET: "vanka-universe-test",
      },
      pool: db.pool,
      client: s3.client,
    });

    const record = await store.save(admin, pngFile());
    expect([...s3.objects.keys()]).toEqual([`test/${record.id}.png`]);
    expect(db.rows.get(record.id)?.storage_key).toBe(`test/${record.id}.png`);
  });
});

describe("createDbR2MediaStore — lifecycle", () => {
  it("writes pending, uploads, then flips to ready; list hides pending rows", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({ config: BASE_CONFIG, pool: db.pool, client: s3.client });

    const record = await store.save(admin, pngFile());
    expect(db.rows.get(record.id)?.status).toBe("ready");
    expect(await store.list()).toEqual([record]);

    // A stray pending row stays invisible to users.
    db.rows.set("99999999-9999-4999-8999-999999999999", {
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
      created_at: "2026-01-02T00:00:00.000Z",
      title: null,
      description: null,
      taken_at: null,
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    expect(await store.list()).toHaveLength(1);
    expect(await store.read("99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  it("compensates a failed object upload by deleting the pending row", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({ config: BASE_CONFIG, pool: db.pool, client: s3.client });
    s3.setFailPut(true);

    await expect(store.save(admin, pngFile())).rejects.toThrow("r2 unavailable");
    expect(db.rows.size).toBe(0);
    expect(s3.objects.size).toBe(0);
  });

  it("reads bytes and updates metadata on the ready row", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({ config: BASE_CONFIG, pool: db.pool, client: s3.client });

    const record = await store.save(admin, pngFile());
    const read = await store.read(record.id);
    expect(Buffer.from(read!.data).equals(PNG)).toBe(true);

    const updated = await store.updateMetadata(record.id, { title: "Hai", takenAt: "2020-01-01" });
    expect(updated).toMatchObject({ title: "Hai", takenAt: "2020-01-01" });
    expect(await store.find(record.id)).toMatchObject({ title: "Hai" });
  });

  it("deletes the row and the object", async () => {
    const db = createMemoryPool();
    const s3 = createFakeS3();
    const store = createDbR2MediaStore({ config: BASE_CONFIG, pool: db.pool, client: s3.client });

    const record = await store.save(admin, pngFile());
    await expect(store.remove(record.id)).resolves.toMatchObject({ id: record.id });
    expect(db.rows.size).toBe(0);
    expect(s3.objects.size).toBe(0);
  });
});

describe("createDbR2MediaStore — database failure keeps a safe HTTP mapping", () => {
  it("maps a missing media_objects table to the 503 descriptor (fail-closed)", async () => {
    const db = createMemoryPool();
    const store = createDbR2MediaStore({ config: BASE_CONFIG, pool: db.pool });
    db.failWith(Object.assign(new Error('relation "media_objects" does not exist'), { code: "42P01" }));

    await expect(store.list()).rejects.toBeInstanceOf(MediaObjectsUnavailableError);

    let thrown: unknown;
    try {
      await store.list();
    } catch (error) {
      thrown = error;
    }
    expect(describeMediaStoreError(thrown)).toEqual({
      status: 503,
      code: "MEDIA_STORE_NOT_MIGRATED",
      message: "Penyimpanan metadata media belum siap.",
    });
  });
});
