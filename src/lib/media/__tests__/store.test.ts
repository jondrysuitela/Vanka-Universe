import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { rename } from "node:fs/promises";

import type { SessionAdmin } from "@/lib/auth/session";

// The module under test is server-only and pulls the auth guard; neither a DB
// nor the Next runtime is needed for these isolated checks.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

// Wrap `rename` so one test can force an atomic-write failure; every other call
// delegates to the real implementation.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const originalCwd = process.cwd();
let workDir: string;

beforeAll(() => {
  // Redirect storage into a throwaway directory BEFORE the module is imported,
  // so MEDIA_DIR (process.cwd()/storage/media) never points at the project.
  workDir = mkdtempSync(path.join(tmpdir(), "vanka-media-test-"));
  process.chdir(workDir);
});

afterAll(() => {
  process.chdir(originalCwd);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const admin: SessionAdmin = {
  id: "admin-1",
  email: "admin@vanka.test",
  name: "Admin Test",
  role: "owner",
};

function pngBytes(extra = 64): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 7),
  ]);
}

function mp4Bytes(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.alloc(16)]);
}

async function loadStore() {
  return import("@/lib/media/store");
}

function mediaDir(): string {
  return path.join(workDir, "storage", "media");
}

function indexFile(): string {
  return path.join(mediaDir(), "index.json");
}

/** Temp files an atomic write should have cleaned up. */
function tmpLeftovers(): string[] {
  if (!existsSync(mediaDir())) return [];
  return readdirSync(mediaDir()).filter((name) => name.endsWith(".tmp"));
}

describe("media store (isolated)", () => {
  it("stores a valid image and records it in the index", async () => {
    const store = await loadStore();
    const bytes = pngBytes();
    const record = await store.saveMediaUpload(admin, new File([bytes], "foto.png", { type: "image/png" }));

    expect(record.kind).toBe("image");
    expect(record.mime).toBe("image/png");
    expect(record.size).toBe(bytes.byteLength);
    expect(record.ownerId).toBe(admin.id);

    const indexRaw = readFileSync(path.join(workDir, "storage", "media", "index.json"), "utf8");
    const index = JSON.parse(indexRaw) as Array<{ id: string }>;
    expect(index.some((r) => r.id === record.id)).toBe(true);
  });

  it("keeps the stored list across a fresh read", async () => {
    const store = await loadStore();
    const list = await store.listMedia();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("reads the stored bytes back", async () => {
    const store = await loadStore();
    const list = await store.listMedia();
    const target = list[0];
    const found = await store.readMediaFile(target.id);
    expect(found).not.toBeNull();
    expect(found?.record.id).toBe(target.id);
    expect(found?.data.byteLength).toBe(target.size);
    expect(found?.data.subarray(0, 8)).toEqual(pngBytes().subarray(0, 8));
  });

  it("rejects an unsupported type (415)", async () => {
    const store = await loadStore();
    await expect(
      store.saveMediaUpload(admin, new File([Buffer.from("plain text")], "notes.txt", { type: "text/plain" })),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("rejects an oversized image (413)", async () => {
    const store = await loadStore();
    const big = Buffer.concat([pngBytes(0), Buffer.alloc(11 * 1024 * 1024, 1)]);
    await expect(
      store.saveMediaUpload(admin, new File([big], "big.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("accepts a small mp4 as video", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([mp4Bytes()], "klip.mp4", { type: "video/mp4" }));
    expect(record.kind).toBe("video");
    expect(record.mime).toBe("video/mp4");
  });

  it("returns null for an unknown or unsafe id", async () => {
    const store = await loadStore();
    expect(await store.readMediaFile("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await store.readMediaFile("../../etc/passwd")).toBeNull();
  });
});

describe("media index integrity (4G.22)", () => {
  it("treats a missing index as empty storage without writing anything", async () => {
    const store = await loadStore();
    rmSync(indexFile(), { force: true });
    expect(await store.listMedia()).toEqual([]);
    expect(existsSync(indexFile())).toBe(false);
  });

  it("fails closed on malformed JSON instead of reporting empty storage", async () => {
    const store = await loadStore();
    mkdirSync(mediaDir(), { recursive: true });
    writeFileSync(indexFile(), "{ not valid json");

    await expect(store.listMedia()).rejects.toMatchObject({
      name: "MediaIndexError",
      code: "INDEX_CORRUPT",
    });
    await expect(
      store.readMediaFile("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "INDEX_CORRUPT" });

    rmSync(indexFile(), { force: true });
  });

  it("fails closed when the index is not an array of objects", async () => {
    const store = await loadStore();
    mkdirSync(mediaDir(), { recursive: true });
    for (const bad of ["{}", '"text"', "[1,2,3]", "[null]"]) {
      writeFileSync(indexFile(), bad);
      await expect(store.listMedia(), bad).rejects.toMatchObject({ code: "INDEX_CORRUPT" });
    }
    rmSync(indexFile(), { force: true });
  });

  it("fails closed on a non-ENOENT read failure (index path is a directory)", async () => {
    const store = await loadStore();
    mkdirSync(indexFile(), { recursive: true });
    await expect(store.listMedia()).rejects.toMatchObject({ code: "INDEX_READ_FAILED" });
    rmSync(indexFile(), { recursive: true, force: true });
  });

  it("never overwrites a corrupt index with an empty array", async () => {
    const store = await loadStore();
    mkdirSync(mediaDir(), { recursive: true });
    writeFileSync(indexFile(), "{ broken");

    await expect(
      store.saveMediaUpload(admin, new File([pngBytes()], "x.png", { type: "image/png" })),
    ).rejects.toMatchObject({ code: "INDEX_CORRUPT" });
    // The corrupt bytes survive: nothing silently replaced them.
    expect(readFileSync(indexFile(), "utf8")).toBe("{ broken");

    rmSync(indexFile(), { force: true });
  });

  it("keeps the previous index intact and cleans up when rename fails (atomic write)", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(
      admin,
      new File([pngBytes()], "atomic.png", { type: "image/png" }),
    );
    const before = readFileSync(indexFile(), "utf8");

    vi.mocked(rename).mockRejectedValueOnce(new Error("simulated rename failure"));
    await expect(store.updateMediaMetadata(record.id, { title: "Nope" })).rejects.toThrow(
      "simulated rename failure",
    );

    expect(readFileSync(indexFile(), "utf8")).toBe(before);
    expect(tmpLeftovers()).toEqual([]);
  });

  it("does not lose records when uploads run concurrently (in-process lock)", async () => {
    const store = await loadStore();
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.saveMediaUpload(admin, new File([pngBytes()], `c-${i}.png`, { type: "image/png" })),
      ),
    );

    const ids = new Set((await store.listMedia()).map((r) => r.id));
    for (const record of created) expect(ids.has(record.id)).toBe(true);
    expect(tmpLeftovers()).toEqual([]);
  });
});
