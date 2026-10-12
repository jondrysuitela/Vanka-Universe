import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/auth/guard";
import type { SessionAdmin } from "@/lib/auth/session";
import {
  deleteMediaObjectRow,
  insertPendingMediaObject,
  listMediaObjectsByStatus,
  markMediaObjectReady,
  reinsertMediaObjectRow,
  rowToRecord,
  selectReadyMediaObject,
  updateReadyMediaObjectMetadata,
  type MediaQueryable,
} from "@/lib/media/db/repository";
import { MediaMetadataIntegrityError } from "@/lib/media/db/errors";
import { MIME_MAP, extensionForMime, sniffMime } from "@/lib/media/storage/mime";
import type { MediaObjectClient } from "@/lib/media/storage/object-client";
import type {
  MediaCollection,
  MediaMetadataPatch,
  MediaRecord,
  MediaStore,
  MediaUploadMetadata,
} from "@/lib/media/storage/types";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/media/storage/types";

/**
 * Database-backed `MediaStore` (Tahap 4G.40D-3B).
 *
 * Postgres is the source of truth for metadata (see the `media_objects` draft
 * migration); R2 stores bytes only, through a `MediaObjectClient`.
 *
 * Object and database writes are NOT atomic together. Upload ordering is:
 *   1. INSERT `pending` row            (atomic single statement)
 *   2. PUT object                      (R2)
 *   3. UPDATE row -> `ready`           (atomic single statement)
 * so an untracked object can never exist: the worst case is a `pending` row,
 * which is never user-visible and is listable for an ops/cleanup job.
 *
 * This module is selected ONLY through the explicit `db-r2` provider
 * (`storage/index.ts` -> `createDbR2MediaStore`, Tahap 4G.40D-4). The default
 * driver stays `filesystem`, so production behavior is unchanged until an
 * operator sets `MEDIA_STORAGE_DRIVER=db-r2`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Test-only default prefix; a real deployment must set its own explicit value. */
export const DEFAULT_DB_TEST_PREFIX = "test/";

export interface DbMediaStoreOptions {
  pool: MediaQueryable;
  objects: MediaObjectClient;
  /** Server-controlled object key prefix. Defaults to the test prefix. */
  keyPrefix?: string;
  /** Storage provider tag persisted with each row. Defaults to "r2". */
  storageProvider?: string;
}

export function createDbMediaStore(options: DbMediaStoreOptions): MediaStore {
  const { pool, objects } = options;
  const keyPrefix = options.keyPrefix ?? DEFAULT_DB_TEST_PREFIX;
  const storageProvider = options.storageProvider ?? "r2";

  /** Server-generated key: validated UUID + server-determined extension. */
  function objectKeyFor(id: string, mime: string): string {
    if (!UUID_RE.test(id)) {
      throw new MediaMetadataIntegrityError("Invalid media id for object key.");
    }
    const ext = extensionForMime(mime);
    if (!ext) {
      throw new MediaMetadataIntegrityError("Unsupported MIME type for object key.");
    }
    return `${keyPrefix}${id}.${ext}`;
  }

  async function list(): Promise<MediaRecord[]> {
    const rows = await listMediaObjectsByStatus(pool, "ready");
    return rows.map(rowToRecord);
  }

  async function find(id: string): Promise<MediaRecord | null> {
    const row = await selectReadyMediaObject(pool, id);
    return row ? rowToRecord(row) : null;
  }

  async function save(
    admin: SessionAdmin,
    file: File,
    collection: MediaCollection = "birthday",
    metadata?: MediaUploadMetadata,
  ): Promise<MediaRecord> {
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = sniffMime(bytes);
    if (!mime) {
      throw new ApiError(415, "UNSUPPORTED_TYPE", "Tipe media tidak didukung.");
    }
    const meta = MIME_MAP[mime];
    const limit = meta.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (bytes.byteLength > limit) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran media melebihi batas.");
    }

    const id = randomUUID();
    const key = objectKeyFor(id, mime);
    const displayName = file.name ? file.name.slice(0, 255) : `${id}.${extensionForMime(mime)}`;

    // Window 1: metadata row. Nothing reaches R2 if this fails.
    await insertPendingMediaObject(pool, {
      id,
      storageProvider,
      storageKey: key,
      mime,
      kind: meta.kind,
      size: bytes.byteLength,
      displayName,
      ownerId: admin.id,
      ownerLabel: admin.name,
      collection,
      title: metadata?.title?.trim() || null,
      description: metadata?.description?.trim() || null,
    });

    // Window 2: object upload.
    try {
      await objects.put(key, bytes, mime);
    } catch (error) {
      try {
        await deleteMediaObjectRow(pool, id);
      } catch {
        throw new MediaMetadataIntegrityError(
          "Upload gagal dan baris pending tidak dapat dibersihkan.",
        );
      }
      throw error;
    }

    // Window 3: pending -> ready.
    try {
      const ready = await markMediaObjectReady(pool, id);
      if (ready) return rowToRecord(ready);
    } catch (error) {
      await compensateFailedSave(id, key);
      throw error;
    }

    // markReady returned null: the row vanished. Tear everything down.
    await compensateFailedSave(id, key);
    throw new MediaMetadataIntegrityError("Baris metadata hilang saat menandai siap.");
  }

  /**
   * Compensating action for window 3 failure: remove the object, then the row.
   * If either cleanup fails, the state stays visible (`pending` row and/or
   * bytes) rather than silently claimed as success.
   */
  async function compensateFailedSave(id: string, key: string): Promise<void> {
    let objectError: unknown;
    try {
      await objects.delete(key);
    } catch (error) {
      objectError = error;
    }

    let rowError: unknown;
    try {
      await deleteMediaObjectRow(pool, id);
    } catch (error) {
      rowError = error;
    }

    if (objectError || rowError) {
      throw new MediaMetadataIntegrityError(
        "Gagal menyelesaikan unggahan; objek dan/atau baris pending tertinggal.",
      );
    }
  }

  async function read(id: string): Promise<{ record: MediaRecord; data: Buffer } | null> {
    const row = await selectReadyMediaObject(pool, id);
    if (!row) return null;

    const data = await objects.get(row.storage_key);
    if (data === null) return null;
    return { record: rowToRecord(row), data };
  }

  async function updateMetadata(
    id: string,
    patch: MediaMetadataPatch,
  ): Promise<MediaRecord | null> {
    const row = await updateReadyMediaObjectMetadata(pool, id, patch);
    return row ? rowToRecord(row) : null;
  }

  async function remove(id: string): Promise<MediaRecord | null> {
    const existing = await selectReadyMediaObject(pool, id);
    if (!existing) return null;

    // Single-statement DELETE first: a concurrent delete cannot both win.
    const row = await deleteMediaObjectRow(pool, id);
    if (!row) return null;

    try {
      await objects.delete(row.storage_key);
    } catch (error) {
      // Restore metadata so it is never silently missing while bytes remain.
      try {
        await reinsertMediaObjectRow(pool, row);
      } catch {
        throw new MediaMetadataIntegrityError(
          "Gagal menghapus objek dan gagal memulihkan baris metadata.",
        );
      }
      throw error;
    }
    return rowToRecord(row);
  }

  return { list, save, read, find, updateMetadata, remove };
}
