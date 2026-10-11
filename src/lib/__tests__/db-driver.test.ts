import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the explicit pg/neon driver selection in src/lib/db.ts.
 * No real database is ever touched: both driver modules are mocked, and the
 * pools are never queried. All assertions are about selection, fail-fast
 * behavior and lazy caching.
 */

const h = vi.hoisted(() => {
  return {
    pgPool: class MockPgPool {
      constructor(public readonly config: unknown) {}
      query(): void {}
    },
    neonPool: class MockNeonPool {
      constructor(public readonly config: unknown) {}
      query(): void {}
    },
    setTypeParser: vi.fn(),
  };
});

vi.mock("pg", () => ({
  Pool: h.pgPool,
  types: { setTypeParser: h.setTypeParser },
}));
vi.mock("@neondatabase/serverless", () => ({
  Pool: h.neonPool,
}));
// `server-only` throws when imported outside Next's bundler; no-op for tests.
vi.mock("server-only", () => ({}));

async function loadDb(): Promise<typeof import("@/lib/db")> {
  return import("@/lib/db");
}

const DUMMY_URL = "postgres://user:pass@127.0.0.1:5432/db";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  h.setTypeParser.mockClear();
});

describe("getPool driver selection", () => {
  it("rejects an unknown DB_DRIVER with a clear config error (no fallback)", async () => {
    vi.stubEnv("DB_DRIVER", "oracle");
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    expect(() => db.getPool()).toThrow(/DB_DRIVER/);
  });

  it("rejects an empty DB_DRIVER as a config error", async () => {
    vi.stubEnv("DB_DRIVER", "");
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    expect(() => db.getPool()).toThrow(/DB_DRIVER/);
  });

  it("rejects a missing DB_DRIVER even before DATABASE_URL is examined", async () => {
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    expect(() => db.getPool()).toThrow(/DB_DRIVER/);
  });

  it("selects the pg pool when DB_DRIVER=pg", async () => {
    vi.stubEnv("DB_DRIVER", "pg");
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    const pool = db.getPool();
    expect(pool).toBeInstanceOf(h.pgPool);
    expect((pool as unknown as { config: { max: number } }).config).toMatchObject({ max: 5 });
    expect(typeof pool.query).toBe("function");
  });

  it("selects the neon pool when DB_DRIVER=neon", async () => {
    vi.stubEnv("DB_DRIVER", "neon");
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    const pool = db.getPool();
    expect(pool).toBeInstanceOf(h.neonPool);
    expect((pool as unknown as { config: { max: number } }).config).toMatchObject({ max: 5 });
    expect(typeof pool.query).toBe("function");
  });

  it("registers the pg DATE type parser on module load", async () => {
    await loadDb();
    expect(h.setTypeParser).toHaveBeenCalledTimes(1);
    expect(h.setTypeParser.mock.calls[0][0]).toBe(1082); // DATE OID
  });

  it("fails with a generic error when DATABASE_URL is missing", async () => {
    vi.stubEnv("DB_DRIVER", "pg");
    vi.stubEnv("DATABASE_URL", "");
    const db = await loadDb();
    expect(() => db.getPool()).toThrow(/Database is not configured/);
  });

  it("caches the pool across repeated getPool() calls", async () => {
    vi.stubEnv("DB_DRIVER", "pg");
    vi.stubEnv("DATABASE_URL", DUMMY_URL);
    const db = await loadDb();
    expect(db.getPool()).toBe(db.getPool());
  });
});