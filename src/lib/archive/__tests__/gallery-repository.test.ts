import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool, type FakeResult } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  GalleryNotMigratedError,
  isUndefinedTableError,
  replaceGallery,
  selectGallery,
} from "@/lib/archive/gallery-repository";
import type { SessionAdmin } from "@/lib/auth/session";

const IMG_A = "11111111-1111-4111-8111-111111111111";
const IMG_B = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";

type Fake = ReturnType<typeof createFakePool>;

const admin: SessionAdmin = {
  id: "admin-1",
  email: "owner@vanka.test",
  name: "Owner",
  role: "owner",
};

function rowsResult(rows: Record<string, unknown>[]): FakeResult {
  return { rows, rowCount: rows.length };
}

const undefinedTable = () => {
  throw Object.assign(new Error('relation "private_archive_media" does not exist'), {
    code: "42P01",
  });
};

let fake: Fake;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("isUndefinedTableError", () => {
  it("matches only code 42P01", () => {
    expect(isUndefinedTableError({ code: "42P01" })).toBe(true);
    expect(isUndefinedTableError({ code: "23505" })).toBe(false);
    expect(isUndefinedTableError(new Error("x"))).toBe(false);
    expect(isUndefinedTableError(null)).toBe(false);
  });
});

describe("selectGallery", () => {
  it("shapes an intro and sorts gallery photos and videos by position", async () => {
    fake.when("FROM private_archive_media", () =>
      rowsResult([
        { media_id: IMG_B, role: "photo", title: "B", description: "", memory_date: null, position: 1 },
        { media_id: VID, role: "intro", title: "", description: "", memory_date: null, position: 0 },
        { media_id: IMG_A, role: "photo", title: "A", description: "", memory_date: "2026-01-02", position: 0 },
        { media_id: VID.replace("3333", "4444"), role: "video", title: "Video", description: "", memory_date: null, position: 1 },
      ]),
    );
    const gallery = await selectGallery();
    expect(gallery.introMediaId).toBe(VID);
    expect(gallery.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    expect(gallery.videos.map((video) => video.mediaId)).toEqual([
      VID.replace("3333", "4444"),
    ]);
    expect(gallery.photos[0].memoryDate).toBe("2026-01-02");
  });

  it("returns an empty gallery when there are no rows", async () => {
    fake.when("FROM private_archive_media", () => rowsResult([]));
    expect(await selectGallery()).toEqual({ introMediaId: null, photos: [], videos: [] });
  });

  it("raises GalleryNotMigratedError when the table is missing", async () => {
    fake.when("FROM private_archive_media", undefinedTable);
    await expect(selectGallery()).rejects.toBeInstanceOf(GalleryNotMigratedError);
  });
});

describe("replaceGallery", () => {
  it("derives roles/positions from input order and ensures the archive row", async () => {
    fake.when("INSERT INTO private_archive_media", () =>
      rowsResult([
        { media_id: VID, role: "intro", title: "", description: "", memory_date: null, position: 0 },
        { media_id: IMG_A, role: "photo", title: "A", description: "Cerita", memory_date: "2026-01-02", position: 0 },
        { media_id: IMG_B, role: "photo", title: "B", description: "", memory_date: null, position: 1 },
        { media_id: IMG_B.replace("2222", "4444"), role: "video", title: "V", description: "", memory_date: null, position: 0 },
      ]),
    );

    const gallery = await replaceGallery(admin, {
      introMediaId: VID,
      photos: [
        { mediaId: IMG_A, title: "A", description: "Cerita", memoryDate: "2026-01-02" },
        { mediaId: IMG_B, title: "B", description: "", memoryDate: null },
      ],
      videos: [
        { mediaId: IMG_B.replace("2222", "4444"), title: "V", description: "", memoryDate: null },
      ],
    });

    const call = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO private_archive_media"),
    );
    expect(call).toBeDefined();
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT (slug) DO NOTHING");
    expect(sql).toContain("ON CONFLICT (archive_id, media_id) DO UPDATE");
    expect(sql).toContain("unnest(");
    // params: slug, admin id, mediaIds, roles, titles, descriptions, dates, positions
    expect(params[0]).toBe("tentang-ibumu");
    expect(params[1]).toBe("admin-1");
    expect(params[2]).toEqual([VID, IMG_A, IMG_B, IMG_B.replace("2222", "4444")]);
    expect(params[3]).toEqual(["intro", "photo", "photo", "video"]);
    expect(params[7]).toEqual([0, 0, 1, 0]);

    expect(gallery.introMediaId).toBe(VID);
    expect(gallery.photos.map((p) => p.mediaId)).toEqual([IMG_A, IMG_B]);
    expect(gallery.videos.map((video) => video.mediaId)).toEqual([IMG_B.replace("2222", "4444")]);
  });

  it("handles an empty gallery (no intro, photos, or videos)", async () => {
    fake.when("INSERT INTO private_archive_media", () => rowsResult([]));
    const gallery = await replaceGallery(admin, { introMediaId: null, photos: [], videos: [] });
    expect(gallery).toEqual({ introMediaId: null, photos: [], videos: [] });
  });

  it("raises GalleryNotMigratedError when the table is missing", async () => {
    fake.when("INSERT INTO private_archive_media", undefinedTable);
    await expect(
      replaceGallery(admin, { introMediaId: null, photos: [], videos: [] }),
    ).rejects.toBeInstanceOf(GalleryNotMigratedError);
  });
});
