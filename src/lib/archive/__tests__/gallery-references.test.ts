import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  GALLERY_REFERENCE_SOURCE,
  GalleryReferenceUnavailableError,
  findGalleryMediaReferences,
} from "@/lib/archive/gallery-references";
import { checkMediaReferences } from "@/lib/media/references";

/**
 * The probe is imported for real (it self-registers on import), so these tests
 * cover BOTH the probe function and its integration with the fail-closed
 * registry. No database is ever contacted.
 */

const MEDIA = "11111111-1111-4111-8111-111111111111";
type Fake = ReturnType<typeof createFakePool>;

const ok = (rows: FakeResult["rows"]): FakeResult => ({ rows, rowCount: rows.length });

function notMigrated() {
  return Object.assign(new Error('relation "private_archive_media" does not exist'), {
    code: "42P01",
  });
}

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("findGalleryMediaReferences (read-only probe)", () => {
  it("returns a reference when the gallery stores this media", async () => {
    fake.when("FROM private_archive_media", () => ok([{ slug: "tentang-ibumu" }]));

    const refs = await findGalleryMediaReferences(MEDIA);

    expect(refs).toEqual([{ source: GALLERY_REFERENCE_SOURCE, detail: "Arsip Ibu (tentang-ibumu)" }]);
    // Id is parameterized, not interpolated.
    const call = fake.query.mock.calls.find(([sql]) => String(sql).includes("FROM private_archive_media"));
    expect(call?.[1]).toEqual([MEDIA]);
  });

  it("returns no references when the gallery is empty for this media", async () => {
    fake.when("FROM private_archive_media", () => ok([]));
    expect(await findGalleryMediaReferences(MEDIA)).toEqual([]);
  });

  it("throws a typed error when the table is not migrated (never 'no references')", async () => {
    fake.when("FROM private_archive_media", () => {
      throw notMigrated();
    });
    await expect(findGalleryMediaReferences(MEDIA)).rejects.toBeInstanceOf(
      GalleryReferenceUnavailableError,
    );
  });

  it("propagates other query errors unchanged", async () => {
    const boom = new Error("connection reset");
    fake.when("FROM private_archive_media", () => {
      throw boom;
    });
    await expect(findGalleryMediaReferences(MEDIA)).rejects.toBe(boom);
  });
});

describe("registry integration (fail-closed delete protection)", () => {
  it("verdict is 'referenced' when the gallery uses the media", async () => {
    fake.when("FROM private_archive_media", () => ok([{ slug: "tentang-ibumu" }]));
    const verdict = await checkMediaReferences(MEDIA);
    expect(verdict.verdict).toBe("referenced");
    if (verdict.verdict === "referenced") {
      expect(verdict.references[0].source).toBe(GALLERY_REFERENCE_SOURCE);
    }
  });

  it("verdict is 'clear' only when the probe verifiably finds nothing", async () => {
    fake.when("FROM private_archive_media", () => ok([]));
    expect((await checkMediaReferences(MEDIA)).verdict).toBe("clear");
  });

  it("verdict is 'unverifiable' (not 'clear') when the gallery table is missing", async () => {
    fake.when("FROM private_archive_media", () => {
      throw notMigrated();
    });
    expect((await checkMediaReferences(MEDIA)).verdict).toBe("unverifiable");
  });

  it("verdict is 'unverifiable' on a generic query error", async () => {
    fake.when("FROM private_archive_media", () => {
      throw new Error("db down");
    });
    expect((await checkMediaReferences(MEDIA)).verdict).toBe("unverifiable");
  });
});
