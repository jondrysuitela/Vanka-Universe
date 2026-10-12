import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SessionAdmin } from "@/lib/auth/session";
import { isIsoDate, updateMediaMetadataSchema } from "@/lib/media/schema";

// The module under test is server-only and pulls the auth guard; neither a DB
// nor the Next runtime is needed for these isolated checks.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

const originalCwd = process.cwd();
let workDir: string;

beforeAll(() => {
  // Redirect storage into a throwaway directory BEFORE the module is imported.
  workDir = mkdtempSync(path.join(tmpdir(), "vanka-media-meta-"));
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

function pngBytes(extra = 64): Buffer<ArrayBuffer> {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 7),
  ]);
}

function indexFile(): string {
  return path.join(workDir, "storage", "media", "index.json");
}

function storedFile(id: string): string {
  return path.join(workDir, "storage", "media", `${id}.png`);
}

async function loadStore() {
  return import("@/lib/media/store");
}

describe("media metadata edit", () => {
  it("updates title/description/takenAt and persists them", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "a.png", { type: "image/png" }));
    expect(record.title).toBeNull();

    const updated = await store.updateMediaMetadata(record.id, {
      title: "Pantai",
      description: "Sore hari",
      takenAt: "2026-01-02",
    });
    expect(updated).toMatchObject({ id: record.id, title: "Pantai", description: "Sore hari", takenAt: "2026-01-02" });

    const reread = await store.findMediaRecord(record.id);
    expect(reread?.title).toBe("Pantai");
    expect(reread?.takenAt).toBe("2026-01-02");
  });

  it("returns null for an unknown id", async () => {
    const store = await loadStore();
    const result = await store.updateMediaMetadata("00000000-0000-0000-0000-000000000000", { title: "x" });
    expect(result).toBeNull();
  });

  it("clears a field when null is provided", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "b.png", { type: "image/png" }));
    await store.updateMediaMetadata(record.id, { title: "T", takenAt: "2026-03-03" });
    const cleared = await store.updateMediaMetadata(record.id, { title: null, takenAt: null });
    expect(cleared?.title).toBeNull();
    expect(cleared?.takenAt).toBeNull();
  });

  it("never changes file facts", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "c.png", { type: "image/png" }));
    const updated = await store.updateMediaMetadata(record.id, { title: "T" });
    expect(updated?.size).toBe(record.size);
    expect(updated?.mime).toBe(record.mime);
    expect(updated?.createdAt).toBe(record.createdAt);
    expect(updated?.ownerId).toBe(record.ownerId);
    expect(updated?.kind).toBe(record.kind);
  });

  it("tolerates legacy index records without metadata fields", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "legacy.png", { type: "image/png" }));
    const rows = JSON.parse(readFileSync(indexFile(), "utf8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      delete row.title;
      delete row.description;
      delete row.takenAt;
    }
    writeFileSync(indexFile(), JSON.stringify(rows));

    const found = await store.findMediaRecord(record.id);
    expect(found?.title).toBeNull();
    expect(found?.description).toBeNull();
    expect(found?.takenAt).toBeNull();
  });
});

describe("media deletion", () => {
  it("removes both the record and the stored file", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "del.png", { type: "image/png" }));
    expect(existsSync(storedFile(record.id))).toBe(true);

    const removed = await store.deleteMedia(record.id);
    expect(removed?.id).toBe(record.id);
    expect(existsSync(storedFile(record.id))).toBe(false);
    expect(await store.findMediaRecord(record.id)).toBeNull();
    expect(await store.readMediaFile(record.id)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const store = await loadStore();
    expect(await store.deleteMedia("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("still removes the index entry when the file is already gone", async () => {
    const store = await loadStore();
    const record = await store.saveMediaUpload(admin, new File([pngBytes()], "gone.png", { type: "image/png" }));
    rmSync(storedFile(record.id));
    const removed = await store.deleteMedia(record.id);
    expect(removed?.id).toBe(record.id);
    expect(await store.findMediaRecord(record.id)).toBeNull();
  });
});

describe("metadata schema validation", () => {
  it("accepts a valid patch", () => {
    expect(updateMediaMetadataSchema.safeParse({ title: "A", takenAt: "2026-01-01" }).success).toBe(true);
    expect(updateMediaMetadataSchema.safeParse({ title: null, description: null }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(updateMediaMetadataSchema.safeParse({}).success).toBe(false);
  });

  it("rejects forbidden provenance/file keys", () => {
    for (const extra of [{ id: "x" }, { ownerId: "x" }, { createdAt: "x" }, { size: 1 }, { mime: "x" }]) {
      expect(updateMediaMetadataSchema.safeParse({ title: "A", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
  });

  it("rejects an invalid capture date", () => {
    expect(updateMediaMetadataSchema.safeParse({ takenAt: "2026-02-30" }).success).toBe(false);
    expect(updateMediaMetadataSchema.safeParse({ takenAt: "nope" }).success).toBe(false);
  });

  it("isIsoDate handles real calendar dates", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2025-02-29")).toBe(false);
  });
});
