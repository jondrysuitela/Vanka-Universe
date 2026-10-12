import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

const store = vi.hoisted(() => ({
  listMedia: vi.fn(),
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
  listMedia: store.listMedia,
  findMediaRecord: store.findMediaRecord,
  MediaIndexError: store.MediaIndexError,
}));

import { GET as galleryGet } from "@/app/api/birthday/gallery/route";
import { MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import type { MediaRecord } from "@/lib/media/storage/types";

const BASE = "https://vanka.test/api/birthday/gallery";
const ADMIN_ID = "admin-owner";
const COOKIE = "vanka_session=token-owner";
const IMG = "11111111-1111-4111-8111-111111111111";

type Fake = ReturnType<typeof createFakePool>;

function adminRow(role = "owner") {
  return {
    id: ADMIN_ID,
    email: "admin@vanka.test",
    name: "Admin Owner",
    role,
    is_active: true,
    session_id: "sess-1",
  };
}

function setupSession(fake: Fake, authed: boolean, role = "owner") {
  fake.when("UPDATE sessions", () => ({ rows: [], rowCount: 1 }));
  fake.when("WITH renewed AS", () => ({
    rows: authed ? [adminRow(role)] : [],
    rowCount: authed ? 1 : 0,
  }));
}

/** One READY birthday media, as the store reports it. */
function galleryRecord(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: IMG,
    kind: "image",
    mime: "image/png",
    name: "vanka.png",
    size: 3,
    ownerId: ADMIN_ID,
    ownerLabel: "Admin Owner",
    createdAt: "2026-05-01T00:00:00.000Z",
    collection: "birthday",
    title: "Senyum pertama",
    description: null,
    takenAt: null,
    ...overrides,
  };
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function headers(cookie?: string): Headers {
  const h = new Headers();
  if (cookie) h.set("cookie", cookie);
  return h;
}

let fake: Fake;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/birthday/gallery — public gate", () => {
  it("answers 403 when a cycle is active but not yet revealed", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const res = await galleryGet(new Request(BASE));
    const payload = await body(res);

    expect(res.status).toBe(403);
    expect((payload.error as { code: string }).code).toBe("GALLERY_LOCKED");
    expect((payload.error as { details: { revealAt: string } }).details.revealAt).toBe(
      "2026-10-26T15:00:00.000Z",
    );
    expect(store.listMedia).not.toHaveBeenCalled();
  });

  it("answers 403 before the very first birthday even exists", async () => {
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    const res = await galleryGet(new Request(BASE));
    expect(res.status).toBe(403);
    expect(((await body(res)).error as { code: string }).code).toBe("GALLERY_LOCKED");
  });

  it("serves the items once the cycle is revealed", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    store.listMedia.mockResolvedValue([galleryRecord()]);

    const res = await galleryGet(new Request(BASE));
    const payload = await body(res);

    expect(res.status).toBe(200);
    expect(store.listMedia).toHaveBeenCalledTimes(1);
    const data = payload.data as { year: number; age: number; revealed: boolean; items: unknown[] };
    expect(data.year).toBe(2026);
    expect(data.age).toBe(1);
    expect(data.revealed).toBe(true);
    expect(data.items).toEqual([
      {
        id: IMG,
        kind: "image",
        mime: "image/png",
        name: "vanka.png",
        title: "Senyum pertama",
        description: null,
        takenAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    ]);
  });

  it("rejects an out-of-registry year with 422", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));

    const res = await galleryGet(new Request(`${BASE}?year=2025`));
    expect(res.status).toBe(422);
    expect(((await body(res)).error as { code: string }).code).toBe("INVALID_YEAR");
    expect(store.listMedia).not.toHaveBeenCalled();
  });

  it("answers 503 when the media store is unavailable", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    store.listMedia.mockRejectedValue(new MediaObjectsUnavailableError());

    const res = await galleryGet(new Request(BASE));
    expect(res.status).toBe(503);
    expect(((await body(res)).error as { code: string }).code).toBe("GALLERY_NOT_MIGRATED");
  });
});

describe("GET /api/birthday/gallery — admin preview", () => {
  it("requires a session: 401 when the preview cookie is absent", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    setupSession(fake, false);

    const res = await galleryGet(new Request(`${BASE}?preview=1`));
    expect(res.status).toBe(401);
    expect(store.listMedia).not.toHaveBeenCalled();
  });

  it("bypasses the gate for an operator session", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    setupSession(fake, true, "admin");
    store.listMedia.mockResolvedValue([galleryRecord()]);

    const res = await galleryGet(new Request(`${BASE}?preview=1`, { headers: headers(COOKIE) }));
    const payload = await body(res);

    expect(res.status).toBe(200);
    const data = payload.data as { year: number; revealed: boolean; items: unknown[] };
    expect(data.year).toBe(2026);
    expect(data.revealed).toBe(false);
    expect(data.items).toHaveLength(1);
  });

  it("denies a non-operator role with 403", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    setupSession(fake, true, "editor");

    const res = await galleryGet(new Request(`${BASE}?preview=1`, { headers: headers(COOKIE) }));
    expect(res.status).toBe(403);
    expect(((await body(res)).error as { code: string }).code).toBe("FORBIDDEN");
    expect(store.listMedia).not.toHaveBeenCalled();
  });

  it("lets an operator preview a chosen year", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    setupSession(fake, true, "owner");
    store.listMedia.mockResolvedValue([]);

    const res = await galleryGet(
      new Request(`${BASE}?preview=1&year=2027`, { headers: headers(COOKIE) }),
    );
    const data = (await body(res)).data as { year: number; age: number };
    expect(res.status).toBe(200);
    expect(data.year).toBe(2027);
    expect(data.age).toBe(2);
  });
});
