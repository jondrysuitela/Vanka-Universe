import "server-only";

import { neon } from "@neondatabase/serverless";
import { Pool as PgPool, types as pgTypes } from "pg";

/**
 * Explicit database driver selection.
 *
 * DB_DRIVER selects the PostgreSQL client:
 *  - "pg"   : node-postgres over a plain TCP connection (local development).
 *  - "neon" : @neondatabase/serverless stateless HTTP driver
 *             (production / Neon / Cloudflare Workers).
 *
 * The choice is explicit server-side configuration — the driver is NEVER
 * guessed from the shape of DATABASE_URL and there is NO silent fallback
 * between drivers. An empty or unknown DB_DRIVER is a configuration error
 * that fails fast when getPool() is first called.
 *
 * - The client is created lazily: importing this module does NOT open a
 *   connection. Connections only start when a query is executed.
 * - The "neon" driver is the stateless HTTP driver on purpose: it keeps no
 *   WebSocket and no connection between requests. A module-level pool over
 *   WebSocket hangs in Cloudflare Workers once the runtime tears down the
 *   previous request's I/O ("your Worker's code had hung"). Because every
 *   query here is a single statement (never a BEGIN/COMMIT spanning calls),
 *   the stateless driver is a drop-in replacement.
 * - DATABASE_URL is never exposed to the client and never logged here.
 * - All queries must use parameters (`$1`, `$2`, ...). Never interpolate user
 *   input into SQL.
 * - `server-only` guarantees none of this (nor the `pg` dependency) can be
 *   pulled into a client bundle.
 */

export const DRIVER_VALUES = ["pg", "neon"] as const;
export type DbDriver = (typeof DRIVER_VALUES)[number];

const POOL_MAX = 5;

/** Minimal query surface shared by both drivers (node-postgres compatible). */
export interface DbPool {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

let cachedPool: DbPool | undefined;

// Keep pg's DATE (OID 1082) parsing identical to the Neon driver: a plain
// 'YYYY-MM-DD' string (the contract used by `memory_date` in
// src/lib/memories/repository.ts), not a JS Date object. Neon's own type
// parsing is untouched. Applied once, server-side, for the pg driver only.
pgTypes.setTypeParser(1082, (value) => value);

function resolveDriver(): DbDriver {
  const driver = process.env.DB_DRIVER;
  if (!driver || !(DRIVER_VALUES as readonly string[]).includes(driver)) {
    throw new Error(
      `Invalid or missing DB_DRIVER "${driver ?? ""}". ` +
        `Set DB_DRIVER to "pg" (local PostgreSQL over TCP) or "neon" (Neon).`,
    );
  }
  return driver as DbDriver;
}

/**
 * Neon's stateless HTTP driver: every query is an independent HTTPS request.
 * No WebSocket, no connection reuse, nothing that survives the end of a
 * request — the only shape that is safe in the Workers runtime.
 */
function createNeonPool(connectionString: string): DbPool {
  const sql = neon(connectionString);
  return {
    async query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
      const rows = await sql.query(text, (values ?? []) as unknown[]);
      return { rows: rows as T[] };
    },
  };
}

function createPool(driver: DbDriver): DbPool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Deliberately generic: no host, user, or connection details.
    throw new Error("Database is not configured on this server.");
  }
  if (driver === "neon") {
    return createNeonPool(connectionString);
  }
  return new PgPool({ connectionString, max: POOL_MAX });
}

export function getPool(): DbPool {
  const driver = resolveDriver();
  if (!cachedPool) {
    cachedPool = createPool(driver);
  }
  return cachedPool;
}