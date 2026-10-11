import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

import { createR2ObjectClient } from "@/lib/media/storage/object-client";
import type { R2Config } from "@/lib/media/storage/r2";

const CONFIG: R2Config = {
  accountId: "acct",
  accessKeyId: "key-id",
  secretAccessKey: "secret-value",
  bucket: "vanka-universe-test",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  keyPrefix: "test/",
  metadataKey: "test/index.json",
};

function notFound(): Error {
  const error = new Error("not found");
  error.name = "NoSuchKey";
  return error;
}

function createFake() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const sent: Array<{ name: string; bucket: string | undefined; key: string | undefined }> = [];
  let mode: "ok" | "get-missing" | "get-error" | "head-missing" | "head-error" | "delete-missing" | "delete-error" = "ok";

  const client = {
    async send(command: unknown): Promise<unknown> {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: { Key: string; Bucket?: string; Body?: Buffer } }).input;
      calls.push(`${name}`);
      sent.push({ name, bucket: input.Bucket, key: input.Key });

      if (name === "PutObjectCommand") {
        objects.set(input.Key, Buffer.from(input.Body as Buffer));
        return {};
      }
      if (name === "GetObjectCommand") {
        if (mode === "get-error") throw new Error("boom");
        if (mode === "get-missing" || !objects.has(input.Key)) throw notFound();
        const buf = objects.get(input.Key)!;
        return { Body: { transformToByteArray: async () => new Uint8Array(buf) } };
      }
      if (name === "HeadObjectCommand") {
        if (mode === "head-error") throw new Error("boom");
        if (mode === "head-missing" || !objects.has(input.Key)) throw notFound();
        return {};
      }
      if (name === "DeleteObjectCommand") {
        if (mode === "delete-error") throw new Error("boom");
        if (mode === "delete-missing" || !objects.has(input.Key)) throw notFound();
        objects.delete(input.Key);
        return {};
      }
      throw new Error(`unexpected command ${name}`);
    },
  };

  return {
    client,
    objects,
    calls,
    sent,
    setMode(next: typeof mode) {
      mode = next;
    },
  };
}

describe("createR2ObjectClient", () => {
  it("puts bytes and reads them back", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    const bytes = Buffer.from([1, 2, 3]);

    await objects.put("test/abc.png", bytes, "image/png");
    expect(fake.objects.has("test/abc.png")).toBe(true);

    const read = await objects.get("test/abc.png");
    expect(read && Buffer.from(read).equals(bytes)).toBe(true);
  });

  it("returns null for a missing object (GetObject 404)", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    fake.setMode("get-missing");
    expect(await objects.get("test/missing.png")).toBeNull();
  });

  it("reports existence via a cheap HEAD probe", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    await objects.put("test/here.png", Buffer.from([1]), "image/png");

    expect(await objects.exists("test/here.png")).toBe(true);
    fake.setMode("head-missing");
    expect(await objects.exists("test/gone.png")).toBe(false);
  });

  it("propagates a non-404 HEAD error", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    fake.setMode("head-error");
    await expect(objects.exists("test/x.png")).rejects.toThrow("boom");
  });

  it("propagates a non-404 read error", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    fake.setMode("get-error");
    await expect(objects.get("test/x.png")).rejects.toThrow("boom");
  });

  it("treats a missing object as a successful, idempotent delete", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    fake.setMode("delete-missing");
    await expect(objects.delete("test/gone.png")).resolves.toBeUndefined();
  });

  it("propagates a non-404 delete error", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    fake.setMode("delete-error");
    await expect(objects.delete("test/x.png")).rejects.toThrow("boom");
  });

  it("keeps the bucket private: only path-style object commands, never URLs/presigned", async () => {
    const fake = createFake();
    const objects = createR2ObjectClient({ client: fake.client, config: CONFIG });
    const bytes = Buffer.from([1, 2, 3]);

    await objects.put("test/a.png", bytes, "image/png");
    const read = await objects.get("test/a.png");
    await objects.exists("test/a.png");
    await objects.delete("test/a.png");

    // Only the four raw S3 object commands may ever leave this client. No
    // presigning (no GetSignedUrl/PresignedUrl command) and no public-URL
    // access anywhere in the request path.
    expect(fake.calls).toEqual([
      "PutObjectCommand",
      "GetObjectCommand",
      "HeadObjectCommand",
      "DeleteObjectCommand",
    ]);

    // Every command addresses the configured bucket by NAME + object KEY, never
    // by a bucket URL; keys stay server-side and are never returned to callers.
    for (const command of fake.sent) {
      expect(command.name).toMatch(/^(Put|Get|Head|Delete)ObjectCommand$/);
      expect(command.bucket).toBe(CONFIG.bucket);
      expect(command.key).toMatch(/^test\//);
      expect(JSON.stringify(command)).not.toContain("https://");
      expect(JSON.stringify(command)).not.toContain("presign");
    }

    // Bytes are returned raw; no URL/key/metadata is part of a read result.
    expect(Buffer.isBuffer(read)).toBe(true);
  });
});
