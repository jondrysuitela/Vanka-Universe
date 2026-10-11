import { getPool } from "@/lib/db";
import type { SessionAdmin } from "@/lib/auth/session";
import { memoryReadScopeSql, type MemoryAccessRow } from "@/lib/memories/policy";
import {
  SORT_COLUMNS,
  type CreateMemoryInput,
  type ListMemoriesQuery,
  type MemoryPrivacy,
  type UpdateMemoryInput,
} from "@/lib/memories/schema";

/**
 * Server-only data access for Memories.
 *
 * Semua query memakai parameter ($1, $2, ...). Tidak ada interpolasi input
 * klien ke dalam string SQL. Kolom yang bisa di-ORDER BY berasal dari whitelist
 * `SORT_COLUMNS`; nilai enum sudah divalidasi Zod sehingga tidak mungkin
 * menyuntikkan ekspresi SQL lewat `sort`.
 */

export interface MemoryRow {
  id: string;
  title: string;
  description: string | null;
  /** DATE dikembalikan driver sebagai string 'YYYY-MM-DD'. */
  memory_date: string;
  category: string | null;
  privacy: MemoryPrivacy;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MemoryAccess = MemoryAccessRow;

const RETURN_COLUMNS =
  "id, title, description, memory_date, category, privacy, owner_id, created_by, created_at, updated_at";

/** Netralkan wildcard ILIKE agar kata kunci pengguna tetap dicari harfiah. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface SelectManyOptions {
  viewer: SessionAdmin;
  query: ListMemoriesQuery;
}

export interface SelectManyResult {
  rows: MemoryRow[];
  total: number;
}

export async function selectMemories(options: SelectManyOptions): Promise<SelectManyResult> {
  const { viewer, query } = options;
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.privacy) {
    params.push(query.privacy);
    where.push(`privacy = $${params.length}`);
  }
  if (query.category) {
    params.push(query.category);
    where.push(`category = $${params.length}`);
  }
  if (query.query) {
    params.push(`%${escapeLike(query.query)}%`);
    const i = params.length;
    where.push(`(title ILIKE $${i} OR COALESCE(description, '') ILIKE $${i})`);
  }
  if (query.date_from) {
    params.push(query.date_from);
    where.push(`memory_date >= $${params.length}`);
  }
  if (query.date_to) {
    params.push(query.date_to);
    where.push(`memory_date <= $${params.length}`);
  }

  // Visibilitas DIKUATKAN di database, bukan di UI.
  const scope = memoryReadScopeSql(viewer, params.length + 1);
  if (scope) {
    params.push(viewer.id);
    where.push(`(${scope})`);
  }

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const filterParams = [...params];

  const pool = getPool();
  const countResult = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memories${whereSql}`,
    filterParams,
  );
  const total = countResult.rows[0]?.n ?? 0;

  // Whitelist: `query.sort` sudah dibatasi enum Zod ke kunci SORT_COLUMNS.
  const sortColumn = SORT_COLUMNS[query.sort];
  const direction = query.order === "asc" ? "ASC" : "DESC";

  params.push(query.limit);
  const limitIndex = params.length;
  params.push((query.page - 1) * query.limit);
  const offsetIndex = params.length;

  const listResult = await pool.query<MemoryRow>(
    `SELECT ${RETURN_COLUMNS}
       FROM memories${whereSql}
      ORDER BY ${sortColumn} ${direction}, id ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );

  return { rows: listResult.rows, total };
}

export async function selectMemoryById(viewer: SessionAdmin, id: string): Promise<MemoryRow | null> {
  const params: unknown[] = [id];
  const scope = memoryReadScopeSql(viewer, params.length + 1);
  if (scope) {
    params.push(viewer.id);
  }
  const whereSql = scope ? ` AND (${scope})` : "";

  const pool = getPool();
  const result = await pool.query<MemoryRow>(
    `SELECT ${RETURN_COLUMNS} FROM memories WHERE id = $1${whereSql}`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function insertMemory(admin: SessionAdmin, input: CreateMemoryInput): Promise<MemoryRow> {
  const pool = getPool();
  const result = await pool.query<MemoryRow>(
    `INSERT INTO memories (title, description, memory_date, category, privacy, owner_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${RETURN_COLUMNS}`,
    [input.title, input.description, input.memory_date, input.category, input.privacy, admin.id, admin.id],
  );
  return result.rows[0];
}

/** Kolom yang boleh diubah klien. id/created_by/created_at/updated_at tidak ada di sini. */
const UPDATABLE_COLUMNS = {
  title: "title",
  description: "description",
  memory_date: "memory_date",
  category: "category",
  privacy: "privacy",
} as const;

export interface UpdateMemoryOptions {
  viewer: SessionAdmin;
  id: string;
  patch: UpdateMemoryInput;
}

/**
 * Terapkan patch pada satu baris. WHERE ikut memakai scope visibilitas agar
 * tidak ada TOCTOU antara cek otorisasi dan UPDATE. Baris hilang/tidak
 * terlihat -> null (dipetakan ke 404 oleh route).
 */
export async function updateMemory(options: UpdateMemoryOptions): Promise<MemoryRow | null> {
  const { viewer, id, patch } = options;
  const params: unknown[] = [];
  const sets: string[] = [];

  for (const key of Object.keys(patch) as (keyof UpdateMemoryInput)[]) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    params.push(patch[key]);
    sets.push(`${UPDATABLE_COLUMNS[key]} = $${params.length}`);
  }
  if (sets.length === 0) return null;

  // updated_at selalu ditetapkan server-side.
  sets.push("updated_at = now()");

  const scope = memoryReadScopeSql(viewer, params.length + 1);
  if (scope) {
    params.push(viewer.id);
  }
  params.push(id);
  const idIndex = params.length;
  const whereSql = scope ? ` AND (${scope})` : "";

  const pool = getPool();
  const result = await pool.query<MemoryRow>(
    `UPDATE memories SET ${sets.join(", ")} WHERE id = $${idIndex}${whereSql}
     RETURNING ${RETURN_COLUMNS}`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function deleteMemory(id: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM memories WHERE id = $1`, [id]);
}

/** SQLSTATE 23503 = foreign_key_violation (media.memory_id ... ON DELETE RESTRICT). */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23503"
  );
}
