import { describe, expect, it, vi } from "vitest";

// The adapter is server-only and pulls the auth guard; no DB or Next runtime.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

import type { SessionAdmin } from "@/lib/auth/session";
import {
  DEFAULT_TEST_PREFIX,
  R2ConfigError,
  R2IndexError,
  R2IntegrityError,
  createR2MediaStore,
  readR2Config,
  type R2Config,
} from "@/lib/media/storage/r2";

const admin = { id: "admin-1", name: "Admin" } as unknown as SessionAdmin;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const INDEX_KEY = "test/index.json";
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);

function makeConfig(overrides: Partial<R2Config> = {}): R2Config {
  return {
    accountId: "acct",
    accessKeyId: "key-id",
    secretAccessKey: "secret-value",
    bucket: "vanka-universe-test",
    endpoint: "https://acct.r2.cloudflarestorage.com",
    keyPrefix: DEFAULT_TEST_PREFIX,
    metadataKey: INDEX_KEY,
    ...overrides,
  };
}

function notFound(): Error {
  const error = new Error("not found");
  error.name = "NoSuchKey";
  return error;
}

interface Fake {
  client: { send(command: unknown): Promise<unknown> };
  objects: Map<string, Buffer>;
  calls: Array<{ name: string; key: string }>;
  setFailPut(fn: ((key: string) => Error | null) | null): void;
  setFailDelete(fn: ((key: string) => Error | null) | null): void;
}

function createFake(): Fake {
  const objects = new Map<string, Buffer>();
  const calls: Array<{ name: string; key: string }> = [];
  let failPut: ((key: string) => Error | null) | null = null;
  let failDelete: ((key: string) => Error | null) | null = null;

  const client = {
    async send(command: unknown): Promise<unknown> {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: { Key: string; Body?: Buffer } }).input;
      const key = input.Key;
      calls.push({ name, key });

      if (name === "PutObjectCommand") {
        const injected = failPut?.(key) ?? null;
        if (injected) throw injected;
        objects.set(key, Buffer.from(input.Body as Buffer));
        return {};
      }
      if (name === "GetObjectCommand") {
        if (!objects.has(key)) throw notFound();
        const buf = objects.get(key)!;
        return { Body: { transformToByteArray: async () => new Uint8Array(buf) } };
      }
      if (name === "DeleteObjectCommand") {
        const injected = failDelete?.(key) ?? null;
        if (injected) throw injected;
        if (!objects.has(key)) throw notFound();
        objects.delete(key);
        return {};
      }
      throw new Error(`unexpected command: ${name}`);
    },
  };

  return {
    client,
    objects,
    calls,
    setFailPut: (fn) => {
      failPut = fn;
    },
    setFailDelete: (fn) => {
      failDelete = fn;
    },
  };
}

function pngFile(name = "foto.png"): File {
  return new File([new Uint8Array(PNG)], name, { type: "image/png" });
}

function mp3File(bytes: Buffer = MP3): File {
  return new File([new Uint8Array(bytes)], "lagu.mp3", { type: "audio/mpeg" });
}

/** Build a ProcessEnv-like map for readR2Config without touching process.env. */
function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

describe("readR2Config", () => {
  it("reports a missing required variable without leaking values", () => {
    let error: unknown;
    try {
      readR2Config(env({}));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(R2ConfigError);
    expect((error as Error).message).toContain("R2_ACCOUNT_ID");
    expect((error as Error).message).not.toContain("secret");
  });

  it("fails closed when required variables are absent", () => {
    expect(() => readR2Config(env({}))).toThrow(R2ConfigError);
  });

  it("defaults the test prefix and derived metadata key", () => {
    const config = readR2Config(
      env({
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "ak",
        R2_SECRET_ACCESS_KEY: "sk",
        R2_BUCKET: "vanka-universe-test",
      }),
    );
    expect(config.keyPrefix).toBe("test/");
    expect(config.metadataKey).toBe("test/index.json");
    expect(config.endpoint).toBe("https://acct.r2.cloudflarestorage.com");
  });

  it("honors explicit prefix, key, and endpoint", () => {
    const config = readR2Config(
      env({
        R2_ACCOUNT_ID: "acct",
        R2_ACCESS_KEY_ID: "ak",
        R2_SECRET_ACCESS_KEY: "sk",
        R2_BUCKET: "vanka-universe-test",
        R2_KEY_PREFIX: "arsip",
        R2_METADATA_KEY: "arsip/index/meta.json",
        R2_ENDPOINT: "https://example.invalid",
      }),
    );
    expect(config.keyPrefix).toBe("arsip/");
    expect(config.metadataKey).toBe("arsip/index/meta.json");
    expect(config.endpoint).toBe("https://example.invalid");
  });

  it("rejects a metadata key that collides with a media object key", () => {
    expect(() =>
      readR2Config(
        env({
          R2_ACCOUNT_ID: "acct",
          R2_ACCESS_KEY_ID: "ak",
          R2_SECRET_ACCESS_KEY: "sk",
          R2_BUCKET: "vanka-universe-test",
          R2_METADATA_KEY: "test/11111111-1111-1111-1111-111111111111.png",
        }),
      ),
    ).toThrow(R2ConfigError);
  });

  it("rejects an MP3 metadata key that collides with a media object key", () => {
    expect(() =>
      readR2Config(
        env({
          R2_ACCOUNT_ID: "acct",
          R2_ACCESS_KEY_ID: "ak",
          R2_SECRET_ACCESS_KEY: "sk",
          R2_BUCKET: "vanka-universe-test",
          R2_METADATA_KEY: "test/11111111-1111-1111-1111-111111111111.mp3",
        }),
      ),
    ).toThrow(R2ConfigError);
  });

  it("rejects path traversal and malformed input", () => {
    const base = {
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "ak",
      R2_SECRET_ACCESS_KEY: "sk",
      R2_BUCKET: "vanka-universe-test",
    };
    expect(() => readR2Config(env({ ...base, R2_KEY_PREFIX: "../x" }))).toThrow(R2ConfigError);
    expect(() => readR2Config(env({ ...base, R2_METADATA_KEY: "a/../b" }))).toThrow(R2ConfigError);
    expect(() => readR2Config(env({ ...base, R2_BUCKET: "bad bucket" }))).toThrow(R2ConfigError);
  });
});

describe("createR2MediaStore", () => {
  it("reads configuration from the environment only when none is supplied", () => {
    const fake = createFake();
    expect(() => createR2MediaStore({ client: fake.client })).toThrow(R2ConfigError);
    expect(() => createR2MediaStore({ client: fake.client, config: makeConfig() })).not.toThrow();
  });

  it("uploads and updates the isolated metadata index", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });

    const record = await store.save(admin, pngFile());
    expect(record.mime).toBe("image/png");
    expect(record.kind).toBe("image");
    expect(record.title).toBeNull();

    const keys = [...fake.objects.keys()];
    expect(fake.objects.has(INDEX_KEY)).toBe(true);
    expect(keys.some((k) => k.startsWith("test/") && k.endsWith(".png"))).toBe(true);

    const index = JSON.parse(fake.objects.get(INDEX_KEY)!.toString("utf8"));
    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(record.id);
  });

  it("stores MP3 audio and enforces its dedicated size limit", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });

    const record = await store.save(admin, mp3File());
    expect(record.mime).toBe("audio/mpeg");
    expect(record.kind).toBe("audio");
    expect([...fake.objects.keys()].some((key) => key.endsWith(".mp3"))).toBe(true);

    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1);
    MP3.copy(oversized);
    await expect(store.save(admin, mp3File(oversized))).rejects.toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("lists, finds, and reads stored media", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());

    expect(await store.list()).toHaveLength(1);
    expect(await store.find(record.id)).toMatchObject({ id: record.id });

    const read = await store.read(record.id);
    expect(read).not.toBeNull();
    expect(Buffer.from(read!.data).equals(PNG)).toBe(true);
    // Range-compatible: the proxy slices these bytes.
    expect(Buffer.from(read!.data).subarray(0, 4)).toEqual(PNG.subarray(0, 4));
  });

  it("updates metadata", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());

    const updated = await store.updateMetadata(record.id, { title: "Hai", takenAt: "2020-01-01" });
    expect(updated).toMatchObject({ title: "Hai", takenAt: "2020-01-01" });
    expect(await store.find(record.id)).toMatchObject({ title: "Hai" });
  });

  it("replaces image bytes without changing the media id", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());
    const replacementBytes = Buffer.concat([PNG, Buffer.from([0x04, 0x05])]);

    const updated = await store.replaceImage(
      record.id,
      new File([replacementBytes], record.name, { type: record.mime }),
    );
    const stored = await store.read(record.id);

    expect(updated).toMatchObject({ id: record.id, size: replacementBytes.byteLength });
    expect(stored?.data).toEqual(replacementBytes);
  });

  it("restores the original image when the index cannot be updated", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());
    const replacementBytes = Buffer.concat([PNG, Buffer.from([0x04, 0x05])]);
    fake.setFailPut((key) =>
      key === INDEX_KEY ? Object.assign(new Error("index write failed"), { name: "InternalError" }) : null,
    );

    await expect(
      store.replaceImage(record.id, new File([replacementBytes], record.name, { type: record.mime })),
    ).rejects.toThrow("index write failed");
    expect((await store.read(record.id))?.data).toEqual(PNG);
  });

  it("deletes the index entry and the object", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());

    const removed = await store.remove(record.id);
    expect(removed).toMatchObject({ id: record.id });
    expect(await store.list()).toHaveLength(0);
    expect(fake.objects.has(`${DEFAULT_TEST_PREFIX}${record.id}.png`)).toBe(false);
  });

  it("compensates a failed object delete by restoring the index", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());

    fake.setFailDelete(() => Object.assign(new Error("boom"), { name: "InternalError" }));

    await expect(store.remove(record.id)).rejects.toThrow("boom");
    // Index restored: the record is still listed and the object is still present.
    expect(await store.list()).toHaveLength(1);
    expect(fake.objects.has(`${DEFAULT_TEST_PREFIX}${record.id}.png`)).toBe(true);
  });

  it("treats an already-missing object as a successful delete", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());
    fake.objects.delete(`${DEFAULT_TEST_PREFIX}${record.id}.png`);

    await expect(store.remove(record.id)).resolves.toMatchObject({ id: record.id });
    expect(await store.list()).toHaveLength(0);
  });

  it("compensates an index-write failure after upload by deleting the object", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    fake.setFailPut((key) => (key === INDEX_KEY ? Object.assign(new Error("index"), { name: "InternalError" }) : null));

    await expect(store.save(admin, pngFile())).rejects.toThrow("index");
    const remainingMedia = [...fake.objects.keys()].filter((k) => k.startsWith(DEFAULT_TEST_PREFIX));
    expect(remainingMedia).toHaveLength(0);
    expect(fake.objects.has(INDEX_KEY)).toBe(false);
  });

  it("surfaces R2IntegrityError when compensation cannot clean up", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    fake.setFailPut((key) => (key === INDEX_KEY ? new Error("index") : null));
    fake.setFailDelete(() => new Error("delete"));

    await expect(store.save(admin, pngFile())).rejects.toBeInstanceOf(R2IntegrityError);
    // Documented residual: the object may remain orphaned if cleanup also fails.
    const orphans = [...fake.objects.keys()].filter((k) => k.startsWith(DEFAULT_TEST_PREFIX));
    expect(orphans).toHaveLength(1);
  });

  it("returns null when the object is missing but the index is intact", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const record = await store.save(admin, pngFile());
    fake.objects.delete(`${DEFAULT_TEST_PREFIX}${record.id}.png`);

    expect(await store.read(record.id)).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it("returns an empty list when the index object is absent", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    expect(await store.list()).toEqual([]);
    expect(fake.objects.size).toBe(0);
  });

  it("fails closed on a malformed index", async () => {
    const fake = createFake();
    fake.objects.set(INDEX_KEY, Buffer.from("{ not json"));
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    await expect(store.list()).rejects.toMatchObject({ name: "R2IndexError", code: "INDEX_CORRUPT" });

    fake.objects.set(INDEX_KEY, Buffer.from(JSON.stringify({ not: "array" })));
    await expect(store.list()).rejects.toBeInstanceOf(R2IndexError);
  });

  it("isolates keys by the configured prefix", async () => {
    const fake = createFake();
    const config = makeConfig({ keyPrefix: "arsip/", metadataKey: "arsip/index.json" });
    const store = createR2MediaStore({ client: fake.client, config });
    const record = await store.save(admin, pngFile());

    const mediaKey = `arsip/${record.id}.png`;
    expect(fake.objects.has(mediaKey)).toBe(true);
    expect(fake.objects.has("arsip/index.json")).toBe(true);
    expect([...fake.objects.keys()].every((k) => k.startsWith("arsip/"))).toBe(true);
  });

  it("refuses to derive a key from a non-UUID or unsupported MIME record", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });
    const malicious = {
      id: "../../etc/passwd",
      name: "x",
      mime: "image/png",
      kind: "image",
      size: 1,
      ownerId: "a",
      ownerLabel: "A",
      createdAt: new Date().toISOString(),
      title: null,
      description: null,
      takenAt: null,
    };
    const unsupported = { ...malicious, id: "11111111-1111-1111-1111-111111111111", mime: "application/zip" };
    fake.objects.set(INDEX_KEY, Buffer.from(JSON.stringify([malicious, unsupported])));

    await expect(store.read("../../etc/passwd")).rejects.toBeInstanceOf(R2IntegrityError);
    await expect(store.read("11111111-1111-1111-1111-111111111111")).rejects.toBeInstanceOf(
      R2IntegrityError,
    );
  });

  it("serializes overlapping in-process index writes", async () => {
    const fake = createFake();
    const store = createR2MediaStore({ client: fake.client, config: makeConfig() });

    await Promise.all([
      store.save(admin, pngFile("a.png")),
      store.save(admin, pngFile("b.png")),
      store.save(admin, pngFile("c.png")),
    ]);

    expect(await store.list()).toHaveLength(3);
  });
});
