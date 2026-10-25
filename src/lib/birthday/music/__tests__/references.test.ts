import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import { findBirthdayMusicMediaReferences } from "@/lib/birthday/music/references";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  const fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("birthday music media references", () => {
  it("protects attached candidates and published songs from media deletion", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    fake.when("FROM birthday_music m", () => ({
      rows: [{ year: 2026 }],
      rowCount: 1,
    }));

    await expect(findBirthdayMusicMediaReferences(MEDIA_ID)).resolves.toEqual([
      {
        source: "birthday_music",
        detail: "Musik ulang tahun edisi 2026",
      },
    ]);
    expect(fake.query.mock.calls[0]?.[1]).toEqual([MEDIA_ID]);
  });

  it("reports no reference when the song has been detached", async () => {
    const fake = createFakePool();
    (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
    fake.when("FROM birthday_music m", () => ({ rows: [], rowCount: 0 }));

    await expect(findBirthdayMusicMediaReferences(MEDIA_ID)).resolves.toEqual([]);
  });
});
