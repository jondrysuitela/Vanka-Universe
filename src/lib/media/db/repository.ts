import { isUndefinedTableError, MediaObjectsUnavailableError } from "@/lib/media/db/errors";
import type {
  MediaCollection,
  MediaKind,
  MediaMetadataPatch,
  MediaRecord,
} from "@/lib/media/storage/types";

/**
 * Repository for `media_objects` (Tahap 4G.40D-3B).
 *
 * DATABASE is the source of truth for media metadata; R2 stores bytes. Every
 * function here is a SINGLE atomic statement, because the shared `DbPool`
 * exposes only `query()` — there is no `connect()` and no explicit transaction.
 * We therefore never claim cross-statement atomicity.
 *
 * The pool is typed as the minimal {@link MediaQueryable} so the production
 * `DbPool`, a fake in-memory pool, and a simple `{ query }` stub all fit.
 */

/** Minimal query surface: `DbPool` and the test fakes both satisfy this. */
export interface MediaQueryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface MediaObjectRow {
  id: string;
  status: "pending" | "ready";
  storage_provider: string;
  storage_key: string;
  mime_type: string;
  kind: MediaKind;
  file_size: number;
  display_name: string;
  owner_id: string | null;
  owner_label: string | null;
  created_at: string;
  collection: MediaCollection;
  title: string | null;
  description: string | null;
  taken_at: string | null;
  updated_at: string;
}

export interface InsertPendingMediaObjectInput {
  id: string;
  storageProvider: string;
  storageKey: string;
  mime: string;
  kind: MediaKind;
  size: number;
  displayName: string;
  ownerId: string | null;
  ownerLabel: string | null;
  collection?: MediaCollection;
  /** Optional upload-time metadata (trimmed upstream; null when absent). */
  title?: string | null;
  description?: string | null;
}

const RETURN_COLUMNS =
  "id, status, storage_provider, storage_key, mime_type, kind, file_size, display_name, " +
  "owner_id, owner_label, created_at, collection, title, description, taken_at, updated_at";

/** Map a DB row to the existing public `MediaRecord` shape. */
export function rowToRecord(row: MediaObjectRow): MediaRecord {
  return {
    id: row.id,
    name: row.display_name,
    mime: row.mime_type,
    kind: row.kind,
    size: Number(row.file_size),
    ownerId: row.owner_id ?? "",
    ownerLabel: row.owner_label ?? "",
    createdAt: row.created_at,
    collection: row.collection ?? "birthday",
    title: row.title,
    description: row.description,
    takenAt: row.taken_at,
  };
}

/**
 * Run a query, translating `undefined_table` (42P01) into the typed
 * fail-closed error. Any other error is propagated unchanged.
 */
async function guarded<T>(
  pool: MediaQueryable,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    const result = await pool.query(sql, params);
    rows = result.rows;
  } catch (error) {
    if (isUndefinedTableError(error)) throw new MediaObjectsUnavailableError();
    throw error;
  }
  return rows as unknown as T[];
}

/** Insert a `pending` row. The object key is decided server-side. */
export async function insertPendingMediaObject(
  pool: MediaQueryable,
  input: InsertPendingMediaObjectInput,
): Promise<MediaObjectRow> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `INSERT INTO media_objects
       (id, status, storage_provider, storage_key, mime_type, kind,
        file_size, display_name, owner_id, owner_label, collection, title, description)
     VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${RETURN_COLUMNS}`,
    [
      input.id,
      input.storageProvider,
      input.storageKey,
      input.mime,
      input.kind,
      input.size,
      input.displayName,
      input.ownerId,
      input.ownerLabel,
      input.collection ?? "birthday",
      input.title ?? null,
      input.description ?? null,
    ],
  );
  return rows[0];
}

/** Flip a row to `ready` (idempotent for an already-ready row). */
export async function markMediaObjectReady(
  pool: MediaQueryable,
  id: string,
): Promise<MediaObjectRow | null> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `UPDATE media_objects
        SET status = 'ready', updated_at = now()
      WHERE id = $1
      RETURNING ${RETURN_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/** Rows in a given lifecycle status, newest first. */
export async function listMediaObjectsByStatus(
  pool: MediaQueryable,
  status: "pending" | "ready",
): Promise<MediaObjectRow[]> {
  return guarded<MediaObjectRow>(
    pool,
    `SELECT ${RETURN_COLUMNS}
       FROM media_objects
      WHERE status = $1
      ORDER BY created_at DESC, id ASC`,
    [status],
  );
}

/** Any row (pending or ready) by id — used for lifecycle/cleanup. */
export async function selectAnyMediaObject(
  pool: MediaQueryable,
  id: string,
): Promise<MediaObjectRow | null> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `SELECT ${RETURN_COLUMNS} FROM media_objects WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** A READY row by id, or null. Pending rows are intentionally invisible. */
export async function selectReadyMediaObject(
  pool: MediaQueryable,
  id: string,
): Promise<MediaObjectRow | null> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `SELECT ${RETURN_COLUMNS} FROM media_objects WHERE id = $1 AND status = 'ready'`,
    [id],
  );
  return rows[0] ?? null;
}

/** Update human metadata on a READY row; null when not found/not ready. */
export async function updateReadyMediaObjectMetadata(
  pool: MediaQueryable,
  id: string,
  patch: MediaMetadataPatch,
): Promise<MediaObjectRow | null> {
  const columnFor: Record<keyof MediaMetadataPatch, string> = {
    title: "title",
    description: "description",
    takenAt: "taken_at",
  };

  const params: unknown[] = [];
  const sets: string[] = [];
  for (const key of Object.keys(patch) as Array<keyof MediaMetadataPatch>) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    params.push(patch[key] ?? null);
    sets.push(`${columnFor[key]} = $${params.length}`);
  }
  if (sets.length === 0) return selectReadyMediaObject(pool, id);

  sets.push("updated_at = now()");
  params.push(id);
  const idIndex = params.length;

  const rows = await guarded<MediaObjectRow>(
    pool,
    `UPDATE media_objects
        SET ${sets.join(", ")}
      WHERE id = $${idIndex} AND status = 'ready'
      RETURNING ${RETURN_COLUMNS}`,
    params,
  );
  return rows[0] ?? null;
}

/** Delete a row (any status), returning it, or null when absent. */
export async function deleteMediaObjectRow(
  pool: MediaQueryable,
  id: string,
): Promise<MediaObjectRow | null> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `DELETE FROM media_objects WHERE id = $1 RETURNING ${RETURN_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Re-insert a previously deleted row verbatim (compensating action when the
 * object delete fails). `created_at` is preserved so ordering does not change.
 * `ON CONFLICT (id) DO NOTHING` cannot clobber a concurrent row.
 */
export async function reinsertMediaObjectRow(
  pool: MediaQueryable,
  row: MediaObjectRow,
): Promise<MediaObjectRow | null> {
  const rows = await guarded<MediaObjectRow>(
    pool,
    `INSERT INTO media_objects
       (id, status, storage_provider, storage_key, mime_type, kind, file_size,
        display_name, owner_id, owner_label, created_at, title, description, taken_at,
        collection)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO NOTHING
     RETURNING ${RETURN_COLUMNS}`,
    [
      row.id,
      row.status,
      row.storage_provider,
      row.storage_key,
      row.mime_type,
      row.kind,
      row.file_size,
      row.display_name,
      row.owner_id,
      row.owner_label,
      row.created_at,
      row.title,
      row.description,
      row.taken_at,
      row.collection ?? "birthday",
    ],
  );
  return rows[0] ?? null;
}
