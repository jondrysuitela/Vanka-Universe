import { vi } from "vitest";

export interface FakeResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
}

export type QueryHandler = (
  sql: string,
  params?: unknown[],
) => Promise<FakeResult> | FakeResult;

/**
 * Fake in-memory pool for tests. No database is ever contacted.
 * Register handlers with `when(sqlMatch, handler)`; the handler receives the
 * SQL text and parameters so tests can assert what was sent.
 */
export function createFakePool() {
  const handlers: Array<{ match: (sql: string) => boolean; run: QueryHandler }> = [];
  const query = vi.fn((sql: string, params?: unknown[]): Promise<FakeResult> => {
    // Search from the end so later registrations override earlier ones.
    const handler = [...handlers].reverse().find((h) => h.match(sql));
    if (!handler) {
      throw new Error(`test: no fake handler registered for SQL "${sql.slice(0, 100)}..."`);
    }
    return Promise.resolve(handler.run(sql, params));
  });

  return {
    pool: { query },
    query,
    when(match: string | RegExp, run: QueryHandler) {
      handlers.push({
        match: (sql) => (match instanceof RegExp ? match.test(sql) : sql.includes(match)),
        run,
      });
    },
  };
}