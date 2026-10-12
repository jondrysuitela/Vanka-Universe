import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { GET as letterGet } from "@/app/api/birthday/letter/route";

const BASE = "https://vanka.test/api/birthday/letter";
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

function letterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    edition_id: "22222222-2222-4222-8222-222222222222",
    year: 2026,
    title: "Selamat ulang tahun",
    display_date: "27 Oktober 2026",
    full_text: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: { src: `/api/media/${MEDIA_ID}`, alt: "Vanka" },
    status: "draft",
    created_by: "owner",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  vi.useFakeTimers();
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/birthday/letter — public gate", () => {
  it("answers 403 LETTER_LOCKED before the first birthday", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const res = await letterGet(new Request(BASE));
    const payload = await body(res);

    expect(res.status).toBe(403);
    expect((payload.error as { code: string }).code).toBe("LETTER_LOCKED");
    expect((payload.error as { details: { revealAt: string } }).details.revealAt).toBe(
      "2026-10-26T15:00:00.000Z",
    );
    expect(
      fake.query.mock.calls.some(([sql]) => String(sql).includes("FROM birthday_letters")),
    ).toBe(false);
  });

  it("serves the letter once the cycle is revealed", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    fake.when("FROM birthday_letters", () => ({ rows: [letterRow()], rowCount: 1 }));

    const res = await letterGet(new Request(BASE));
    const payload = await body(res);

    expect(res.status).toBe(200);
    const data = payload.data as {
      year: number;
      age: number;
      revealed: boolean;
      letter: { title: string; thumbnail: { src: string; alt: string } };
    };
    expect(data.year).toBe(2026);
    expect(data.age).toBe(1);
    expect(data.revealed).toBe(true);
    expect(data.letter.title).toBe("Selamat ulang tahun");
    expect(data.letter.thumbnail.src).toBe(`/api/birthday/gallery/media/${MEDIA_ID}`);
  });

  it("answers letter:null when the edition has no saved letter yet", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    fake.when("FROM birthday_letters", () => ({ rows: [], rowCount: 0 }));

    const res = await letterGet(new Request(BASE));
    const data = (await body(res)).data as { letter: unknown };
    expect(res.status).toBe(200);
    expect(data.letter).toBeNull();
  });

  it("rejects an out-of-registry year with 422", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));

    const res = await letterGet(new Request(`${BASE}?year=2025`));
    expect(res.status).toBe(422);
    expect(((await body(res)).error as { code: string }).code).toBe("INVALID_YEAR");
  });

  it("answers 403 for an explicit year that is not revealed yet", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));

    const res = await letterGet(new Request(`${BASE}?year=2027`));
    expect(res.status).toBe(403);
    expect(((await body(res)).error as { code: string }).code).toBe("LETTER_LOCKED");
  });

  it("answers 503 when the letters table is missing", async () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    fake.when("FROM birthday_letters", () => {
      throw Object.assign(new Error("no table"), { code: "42P01" });
    });

    const res = await letterGet(new Request(BASE));
    expect(res.status).toBe(503);
    expect(((await body(res)).error as { code: string }).code).toBe("LETTER_NOT_MIGRATED");
  });
});
