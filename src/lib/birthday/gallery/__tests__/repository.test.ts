import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  listMedia: vi.fn(),
  findMediaRecord: vi.fn(),
  MediaIndexError: class MediaIndexError extends Error {
    constructor() {
      super("index rusak");
      this.name = "MediaIndexError";
    }
  },
}));

vi.mock("@/lib/media/store", () => ({
  listMedia: store.listMedia,
  findMediaRecord: store.findMediaRecord,
  MediaIndexError: store.MediaIndexError,
}));

import { cycleWindowForYear } from "@/lib/birthday/cycle";
import {
  BirthdayGalleryUnavailableError,
  isMediaPubliclyRevealed,
  listCycleGallery,
} from "@/lib/birthday/gallery/repository";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import type { MediaRecord } from "@/lib/media/storage/types";

const IMG = "11111111-1111-4111-8111-111111111111";

function record(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: IMG,
    name: "vanka.png",
    mime: "image/png",
    kind: "image",
    size: 3,
    ownerId: "admin",
    ownerLabel: "Admin",
    createdAt: "2026-01-03T00:00:00.000Z",
    collection: "birthday",
    title: "Senyum",
    description: null,
    takenAt: "2026-01-02",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCycleGallery", () => {
  it("reads the media store and keeps only birthday media inside the window", async () => {
    store.listMedia.mockResolvedValue([
      record(),
      // Archive pool — never part of the birthday experience.
      record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", collection: "archive" }),
      // Outside the 2026 cycle window.
      record({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", createdAt: "2025-01-01T00:00:00.000Z" }),
    ]);

    const cycle = cycleWindowForYear(2026)!;
    const items = await listCycleGallery(cycle);

    expect(store.listMedia).toHaveBeenCalledTimes(1);
    expect(items).toEqual([
      {
        id: IMG,
        kind: "image",
        mime: "image/png",
        name: "vanka.png",
        title: "Senyum",
        description: null,
        takenAt: "2026-01-02",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
  });

  it("includes photos taken ON the birthday, but not the day after", async () => {
    // The party photos are taken on 27 October; they belong to THIS album.
    // 28 October 00:00 WIT (UPLOAD_END_2026) already belongs to next year.
    const party = record({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdAt: "2026-10-27T03:00:00.000Z", // 27 Oct 12:00 WIT
    });
    const dayAfter = record({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      createdAt: "2026-10-27T15:00:00.000Z", // 28 Oct 00:00 WIT
    });
    store.listMedia.mockResolvedValue([party, dayAfter]);

    const items = await listCycleGallery(cycleWindowForYear(2026)!);
    expect(items.map((item) => item.id)).toEqual([party.id]);
  });

  it("treats a record with no collection as the birthday pool (legacy index)", async () => {
    const legacy = record();
    delete (legacy as { collection?: unknown }).collection;
    store.listMedia.mockResolvedValue([legacy]);

    const items = await listCycleGallery(cycleWindowForYear(2026)!);
    expect(items).toHaveLength(1);
  });

  it("orders oldest first, then by id", async () => {
    store.listMedia.mockResolvedValue([
      record({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdAt: "2026-03-01T00:00:00.000Z" }),
      record({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);

    const items = await listCycleGallery(cycleWindowForYear(2026)!);
    expect(items.map((i) => i.id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
  });

  it("fails closed when the metadata table is missing", async () => {
    store.listMedia.mockRejectedValue(new MediaObjectsUnavailableError());
    await expect(listCycleGallery(cycleWindowForYear(2026)!)).rejects.toBeInstanceOf(
      BirthdayGalleryUnavailableError,
    );
  });

  it("fails closed when the local index cannot be read", async () => {
    store.listMedia.mockRejectedValue(new store.MediaIndexError());
    await expect(listCycleGallery(cycleWindowForYear(2026)!)).rejects.toBeInstanceOf(
      BirthdayGalleryUnavailableError,
    );
  });
});

describe("isMediaPubliclyRevealed", () => {
  it("is true only once the media's cycle birthday has passed", async () => {
    store.findMediaRecord.mockResolvedValue(record({ createdAt: "2026-05-01T00:00:00.000Z" }));

    expect(await isMediaPubliclyRevealed(IMG, new Date("2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(await isMediaPubliclyRevealed(IMG, new Date("2026-11-01T00:00:00.000Z"))).toBe(true);
  });

  it("is false for an unknown id or archive media", async () => {
    store.findMediaRecord.mockResolvedValue(null);
    expect(await isMediaPubliclyRevealed(IMG, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);

    store.findMediaRecord.mockResolvedValue(record({ collection: "archive" }));
    expect(await isMediaPubliclyRevealed(IMG, new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("fails closed when the store is unavailable", async () => {
    store.findMediaRecord.mockRejectedValue(new MediaObjectsUnavailableError());
    await expect(
      isMediaPubliclyRevealed(IMG, new Date("2030-01-01T00:00:00.000Z")),
    ).rejects.toBeInstanceOf(BirthdayGalleryUnavailableError);
  });
});
