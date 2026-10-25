import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  readMediaFile: vi.fn(),
  findMediaRecord: vi.fn(),
  getPublishedMusicByMediaId: vi.fn(),
}));

vi.mock("@/lib/media/store", () => ({
  readMediaFile: store.readMediaFile,
  findMediaRecord: store.findMediaRecord,
}));

vi.mock("@/lib/birthday/music/repository", () => ({
  getPublishedMusicByMediaId: store.getPublishedMusicByMediaId,
}));

import { GET } from "@/app/api/birthday/music/media/[id]/route";
import type { MediaRecord } from "@/lib/media/storage/types";

const BASE = "https://vanka.test/api/birthday/music/media";
const AUDIO = "11111111-1111-4111-8111-111111111111";

function record(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: AUDIO,
    name: "lagu.mp3",
    mime: "audio/mpeg",
    kind: "audio",
    size: 3,
    ownerId: "admin",
    ownerLabel: "Admin",
    createdAt: "2027-05-01T00:00:00.000Z",
    collection: "music",
    title: null,
    description: null,
    takenAt: null,
    ...overrides,
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
  store.findMediaRecord.mockResolvedValue(record());
  store.getPublishedMusicByMediaId.mockResolvedValue([{
    year: 2026,
    mediaId: AUDIO,
    volume: null,
    age: 1,
    displayName: "lagu.mp3",
    publishedAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  }]);
  store.readMediaFile.mockResolvedValue({ record: record(), data: Buffer.from([1, 2, 3]) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/birthday/music/media/[id]", () => {
  it("does not serve an unpublished candidate even when its upload cycle is revealed", async () => {
    store.getPublishedMusicByMediaId.mockResolvedValue([]);

    const res = await GET(new Request(`${BASE}/${AUDIO}`), ctx(AUDIO));

    expect(res.status).toBe(404);
    expect(store.readMediaFile).not.toHaveBeenCalled();
  });

  it("gates the published song by its assigned edition, not its upload date", async () => {
    store.getPublishedMusicByMediaId.mockResolvedValue([{
      year: 2027,
      mediaId: AUDIO,
      volume: null,
      age: 2,
      displayName: "lagu.mp3",
      publishedAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    }]);

    const res = await GET(new Request(`${BASE}/${AUDIO}`), ctx(AUDIO));

    expect(res.status).toBe(404);
    expect(store.readMediaFile).not.toHaveBeenCalled();
  });

  it("streams an older edition song even when it was uploaded in a newer cycle", async () => {
    const res = await GET(new Request(`${BASE}/${AUDIO}`), ctx(AUDIO));

    expect(res.status).toBe(200);
    expect(store.readMediaFile).toHaveBeenCalledWith(AUDIO);
  });
});
