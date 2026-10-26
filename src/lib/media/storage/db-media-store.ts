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
  selectOwnedMediaObject,
  rowToRecord,
  selectReadyMediaObject,
  updateReadyMediaObjectMetadata,
  updateReadyMediaObjectSize,
  type MediaObjectRow,
  type MediaQueryable,
} from "@/lib/media/db/repository";
import { MediaMetadataIntegrityError } from "@/lib/media/db/errors";
import { readReplacementImage } from "@/lib/media/storage/replace-image";
import { MIME_MAP, extensionForMime, sniffMime } from "@/lib/media/storage/mime";
import type { MediaObjectClient } from "@/lib/media/storage/object-client";
import type {
  MediaCollection,
  MediaMetadataPatch,
  MediaRecord,
  MediaStore,
  MediaUploadMetadata,
} from "@/lib/media/storage/types";
import { maxBytesForKind } from "@/lib/media/storage/types";

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

export interface DirectUploadInput {
  name: string;
  mime: string;
  size: number;
  collection: "archive";
}

export interface DirectUploadPlan {
  id: string;
  url: string;
  headers: Record<string, string>;
}

export interface DirectUploadMediaStore extends MediaStore {
  createDirectUpload(admin: SessionAdmin, input: DirectUploadInput): Promise<DirectUploadPlan>;
  completeDirectUpload(admin: SessionAdmin, id: string): Promise<MediaRecord>;
}

const DIRECT_UPLOAD_URL_TTL_SECONDS = 10 * 60;

export function createDbMediaStore(options: DbMediaStoreOptions): DirectUploadMediaStore {
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
    const limit = maxBytesForKind(meta.kind);
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

  async function createDirectUpload(
    admin: SessionAdmin,
    input: DirectUploadInput,
  ): Promise<DirectUploadPlan> {
    if (input.collection !== "archive") {
      throw new ApiError(422, "INVALID_COLLECTION", "Unggahan langsung hanya untuk Arsip Privat.");
    }
    const meta = MIME_MAP[input.mime];
    if (!meta || meta.kind === "audio") {
      throw new ApiError(415, "UNSUPPORTED_TYPE", "Tipe media tidak didukung.");
    }
    if (
      !Number.isInteger(input.size) ||
      input.size <= 0 ||
      input.size > maxBytesForKind(meta.kind)
    ) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Ukuran media melebihi batas.");
    }

    const id = randomUUID();
    const extension = extensionForMime(input.mime);
    if (!extension) throw new MediaMetadataIntegrityError("Unsupported MIME type for direct upload.");
    const storageKey = objectKeyFor(id, input.mime);
    const stagingKey = `${keyPrefix}pending/${id}.${extension}`;
    const displayName = input.name.trim().slice(0, 255) || `${id}.${extension}`;

    await insertPendingMediaObject(pool, {
      id,
      storageProvider,
      storageKey,
      mime: input.mime,
      kind: meta.kind,
      size: input.size,
      displayName,
      ownerId: admin.id,
      ownerLabel: admin.name,
      collection: input.collection,
    });

    try {
      const url = await objects.presignPut(
        stagingKey,
        input.mime,
        input.size,
        DIRECT_UPLOAD_URL_TTL_SECONDS,
      );
      return { id, url, headers: { "Content-Type": input.mime } };
    } catch (error) {
      await deleteMediaObjectRow(pool, id);
      throw error;
    }
  }

  async function completeDirectUpload(admin: SessionAdmin, id: string): Promise<MediaRecord> {
    const row = await selectOwnedMediaObject(pool, id, admin.id);
    if (!row || row.collection !== "archive" || row.storage_provider !== storageProvider) {
      throw new ApiError(404, "UPLOAD_NOT_FOUND", "Unggahan tidak ditemukan.");
    }
    if (row.status === "ready") return rowToRecord(row);

    const extension = extensionForMime(row.mime_type);
    const meta = MIME_MAP[row.mime_type];
    if (!extension || !meta || meta.kind === "audio" || meta.kind !== row.kind) {
      throw new MediaMetadataIntegrityError("Pending upload metadata is invalid.");
    }

    const stagingKey = `${keyPrefix}pending/${id}.${extension}`;
    const uploaded = await objects.inspect(stagingKey);
    if (!uploaded) {
      throw new ApiError(409, "UPLOAD_NOT_RECEIVED", "File belum selesai diunggah ke penyimpanan.");
    }
    if (uploaded.size !== Number(row.file_size)) {
      await objects.delete(stagingKey);
      await deleteMediaObjectRow(pool, id);
      throw new ApiError(422, "UPLOAD_SIZE_MISMATCH", "Ukuran file yang diterima tidak sesuai.");
    }
    if (
      uploaded.size > maxBytesForKind(row.kind) ||
      uploaded.contentType !== row.mime_type ||
      sniffMime(uploaded.prefix) !== row.mime_type
    ) {
      await objects.delete(stagingKey);
      await deleteMediaObjectRow(pool, id);
      throw new ApiError(415, "UPLOAD_CONTENT_MISMATCH", "Isi file tidak cocok dengan tipe yang dipilih.");
    }

    await objects.copy(stagingKey, row.storage_key, row.mime_type, uploaded.etag);
    const ready = await markMediaObjectReady(pool, id);
    if (!ready) {
      await objects.delete(row.storage_key);
      throw new MediaMetadataIntegrityError("Pending media row disappeared during direct upload.");
    }

    try {
      await objects.delete(stagingKey);
    } catch {
      console.error("direct media upload staging cleanup failed", {
        name: "DirectUploadCleanupError",
        kind: "cleanup",
      });
    }
    return rowToRecord(ready);
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

  async function replaceImage(id: string, file: File): Promise<MediaRecord | null> {
    const row = await selectReadyMediaObject(pool, id);
    if (!row) return null;

    const record = rowToRecord(row);
    const bytes = await readReplacementImage(file, record);
    const previousBytes = await objects.get(row.storage_key);
    if (!previousBytes) {
      throw new MediaMetadataIntegrityError("Objek foto tidak ditemukan saat penggantian.");
    }

    await objects.put(row.storage_key, bytes, record.mime);
    let updated: MediaObjectRow | null;
    try {
      updated = await updateReadyMediaObjectSize(pool, id, bytes.byteLength);
    } catch (error) {
      try {
        await objects.put(row.storage_key, previousBytes, record.mime);
      } catch {
        throw new MediaMetadataIntegrityError(
          "Gagal memperbarui ukuran metadata dan memulihkan foto asli.",
        );
      }
      throw error;
    }

    if (!updated) {
      try {
        await objects.put(row.storage_key, previousBytes, record.mime);
      } catch {
        throw new MediaMetadataIntegrityError(
          "Baris media hilang dan foto asli tidak dapat dipulihkan.",
        );
      }
      return null;
    }
    return rowToRecord(updated);
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

  return {
    list,
    save,
    read,
    find,
    replaceImage,
    updateMetadata,
    remove,
    createDirectUpload,
    completeDirectUpload,
  };
}
