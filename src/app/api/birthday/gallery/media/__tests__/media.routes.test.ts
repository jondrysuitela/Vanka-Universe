import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

const store = vi.hoisted(() => ({
  readMediaFile: vi.fn(),
  findMediaRecord: vi.fn(),
  MediaIndexError: class MediaIndexError extends Error {
    constructor() {
      super("index tidak terbaca");
      this.name = "MediaIndexError";
    }
  },
}));

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

vi.mock("@/lib/media/store", () => ({
  readMediaFile: store.readMediaFile,
  findMediaRecord: store.findMediaRecord,
  MediaIndexError: store.MediaIndexError,
}));

import { GET } from "@/app/api/birthday/gallery/media/[id]/route";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import type { MediaRecord } from "@/lib/media/storage/types";

const BASE = "https://vanka.test/api/birthday/gallery/media";
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
    createdAt: "2026-05-01T00:00:00.000Z",
    collection: "birthday",
    title: null,
    description: null,
    takenAt: null,
    ...overrides,
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  // Freeze the clock after the 2026 birthday so the age-1 cycle is revealed.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/birthday/gallery/media/[id]", () => {
  it("rejects a non-UUID id with 400 without reading the store", async () => {
    const res = await GET(new Request(`${BASE}/nope`), ctx("nope"));
    expect(res.status).toBe(400);
    expect(store.readMediaFile).not.toHaveBeenCalled();
    expect(store.findMediaRecord).not.toHaveBeenCalled();
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("hides media whose cycle is not revealed yet (404)", async () => {
    // Uploaded in the 2027 cycle → first visible 27 Oct 2027, i.e. after "now".
    store.findMediaRecord.mockResolvedValue(record({ createdAt: "2027-05-01T00:00:00.000Z" }));

    const res = await GET(new Request(`${BASE}/${IMG}`), ctx(IMG));
    expect(res.status).toBe(404);
    expect(store.readMediaFile).not.toHaveBeenCalled();
  });

  it("hides archive-pool media even after its cycle is revealed (404)", async () => {
    store.findMediaRecord.mockResolvedValue(record({ collection: "archive" }));

    const res = await GET(new Request(`${BASE}/${IMG}`), ctx(IMG));
    expect(res.status).toBe(404);
    expect(store.readMediaFile).not.toHaveBeenCalled();
  });

  it("streams revealed media with the stored MIME type", async () => {
    store.findMediaRecord.mockResolvedValue(record());
    store.readMediaFile.mockResolvedValue({
      record: record(),
      data: Buffer.from([1, 2, 3]),
    });

    const res = await GET(new Request(`${BASE}/${IMG}`), ctx(IMG));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe("3");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("answers 404 when the reply is revealed but the bytes are gone", async () => {
    store.findMediaRecord.mockResolvedValue(record());
    store.readMediaFile.mockResolvedValue(null);

    const res = await GET(new Request(`${BASE}/${IMG}`), ctx(IMG));
    expect(res.status).toBe(404);
  });

  it("answers 503 when the media store is unavailable", async () => {
    store.findMediaRecord.mockRejectedValue(new MediaObjectsUnavailableError());

    const res = await GET(new Request(`${BASE}/${IMG}`), ctx(IMG));
    expect(res.status).toBe(503);
  });
});
