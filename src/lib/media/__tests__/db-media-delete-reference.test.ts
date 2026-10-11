import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

// Side-effect import registers the real Arsip Ibu gallery probe.
import "@/lib/archive/gallery-references";
import { checkMediaReferences } from "@/lib/media/references";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

/**
 * Mirrors the DELETE route contract: the store is only called after a positive
 * `clear` verdict. It exists so we can assert the new DB-backed store does not
 * bypass reference protection.
 */
async function guardedRemove(
  remove: ReturnType<typeof vi.fn>,
  id: string,
): Promise<"deleted" | "referenced" | "unverifiable"> {
  const verdict = await checkMediaReferences(id);
  if (verdict.verdict === "referenced") return "referenced";
  if (verdict.verdict === "unverifiable") return "unverifiable";
  await remove(id);
  return "deleted";
}

describe("media delete is refused while the gallery still references it", () => {
  let remove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    remove = vi.fn(async () => undefined);
  });

  it("does not delete media referenced by the gallery", async () => {
    fake.when("FROM private_archive_media", () => ({ rows: [{ slug: "tentang-ibumu" }], rowCount: 1 }));

    expect(await guardedRemove(remove, "11111111-1111-4111-8111-111111111111")).toBe("referenced");
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes media once the gallery has no reference", async () => {
    fake.when("FROM private_archive_media", () => ({ rows: [], rowCount: 0 }));

    expect(await guardedRemove(remove, "11111111-1111-4111-8111-111111111111")).toBe("deleted");
    expect(remove).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("fails closed when the reference table is missing", async () => {
    fake.when("FROM private_archive_media", () => {
      throw Object.assign(new Error("42P01"), { code: "42P01" });
    });

    expect(await guardedRemove(remove, "11111111-1111-4111-8111-111111111111")).toBe("unverifiable");
    expect(remove).not.toHaveBeenCalled();
  });
});
