import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { ApiError } from "@/lib/auth/guard";
import type { SessionAdmin } from "@/lib/auth/session";
import { MIME_MAP, sniffMime } from "@/lib/media/storage/mime";
import type { MediaMetadataPatch, MediaRecord, MediaStore } from "@/lib/media/storage/types";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/media/storage/types";

/**
 * Filesystem media provider (Tahap 4G.40C extraction).
 *
 * Verbatim behavior of the original `src/lib/media/store.ts`: private local
 * `storage/media/` directory, JSON index, magic-byte sniffing, size caps, an
 * in-process write lock, and atomic index replacement. This is the DEFAULT
 * provider and the current production behavior.
 */

/**
 * Read and validate the index.
 *
 *  - A MISSING file is a legitimate "no media yet" state -> `[]`.
 *  - Any other read error, invalid JSON, or a structurally invalid document
 *    throws `MediaIndexError` instead of pretending the store is empty.
 */
export class MediaIndexError extends Error {
  constructor(
    public readonly code: "INDEX_READ_FAILED" | "INDEX_CORRUPT",
    message: string,
  ) {
    super(message);
    this.name = "MediaIndexError";
  }
}

const MEDIA_DIR = path.join(process.cwd(), "storage", "media");
const INDEX_FILE = path.join(MEDIA_DIR, "index.json");

async function ensureDir(): Promise<void> {
  await mkdir(MEDIA_DIR, { recursive: true });
}

async function readIndex(): Promise<MediaRecord[]> {
  let raw: string;
  try {
    raw = await readFile(INDEX_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new MediaIndexError("INDEX_READ_FAILED", "Index media tidak dapat dibaca.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MediaIndexError("INDEX_CORRUPT", "Index media rusak dan tidak dapat diurai.");
  }

  if (!Array.isArray(parsed) || parsed.some((row) => typeof row !== "object" || row === null)) {
    throw new MediaIndexError("INDEX_CORRUPT", "Struktur index media tidak valid.");
  }

  return (parsed as MediaRecord[]).map(normalizeRecord);
}

/**
 * Backward-compatible normalization: records written before metadata existed
 * (or from an older format) get `null` metadata instead of `undefined`.
 */
function normalizeRecord(record: MediaRecord): MediaRecord {
  return {
    ...record,
    title: typeof record.title === "string" ? record.title : null,
    description: typeof record.description === "string" ? record.description : null,
    takenAt: typeof record.takenAt === "string" ? record.takenAt : null,
  };
}

/** Absolute path to a record's stored file, or null when it cannot be derived. */
function storedFilePath(record: MediaRecord): string | null {
  const ext = MIME_MAP[record.mime]?.ext;
  if (!ext) return null;
  const storedName = `${record.id}.${ext}`;
  // Defence in depth: the derived name must not escape the media directory.
  if (path.basename(storedName) !== storedName) return null;
  return path.join(MEDIA_DIR, storedName);
}

/**
 * Serialize index mutations WITHIN THIS PROCESS.
 *
 * `index.json` updates are read-modify-write, so two overlapping requests could
 * otherwise lose one another's record. This is a process-local promise chain
 * only: it does NOT protect multiple Node processes. A cross-process lock is
 * deliberately out of scope here.
 */
let indexChain: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(task: () => Promise<T>): Promise<T> {
  const run = indexChain.then(task, task);
  indexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Replace the index atomically: write a sibling temp file, then rename over the
 * real one. A crash before the rename leaves the previous index untouched; the
 * temp file (unique per write, `<index>.json.<uuid>.tmp`) is removed on failure.
 */
async function writeIndex(records: MediaRecord[]): Promise<void> {
  await ensureDir();
  const tempFile = `${INDEX_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, JSON.stringify(records, null, 2), "utf8");
    await rename(tempFile, INDEX_FILE);
  } catch (error) {
    await unlink(tempFile).catch(() => {});
    throw error;
  }
}

async function list(): Promise<MediaRecord[]> {
  return readIndex();
}

async function save(admin: SessionAdmin, file: File): Promise<MediaRecord> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) {
    throw new ApiError(
      415,
      "UNSUPPORTED_TYPE",
      "Tipe file tidak didukung. Gunakan JPEG, PNG, WebP, GIF, atau MP4.",
    );
  }
  const meta = MIME_MAP[mime];
  const limit = meta.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (buf.byteLength > limit) {
    throw new ApiError(
      413,
      "FILE_TOO_LARGE",
      `Ukuran file terlalu besar. Maksimal ${meta.kind === "image" ? "10 MB" : "50 MB"}.`,
    );
  }

  const id = randomUUID();
  const storedName = `${id}.${meta.ext}`;
  await ensureDir();
  await writeFile(path.join(MEDIA_DIR, storedName), buf);

  const displayName = path.basename(file.name).slice(0, 255) || storedName;
  const record: MediaRecord = {
    id,
    name: displayName,
    mime,
    kind: meta.kind,
    size: buf.byteLength,
    ownerId: admin.id,
    ownerLabel: admin.name,
    createdAt: new Date().toISOString(),
    title: null,
    description: null,
    takenAt: null,
  };

  await withIndexLock(async () => {
    const records = await readIndex();
    records.unshift(record);
    await writeIndex(records);
  });
  return record;
}

async function read(id: string): Promise<{ record: MediaRecord; data: Buffer } | null> {
  const records = await readIndex();
  const record = records.find((r) => r.id === id);
  if (!record) return null;
  const filePath = storedFilePath(record);
  if (!filePath) return null;

  try {
    const data = await readFile(filePath);
    return { record, data };
  } catch {
    return null;
  }
}

async function find(id: string): Promise<MediaRecord | null> {
  const records = await readIndex();
  return records.find((r) => r.id === id) ?? null;
}

async function updateMetadata(
  id: string,
  patch: MediaMetadataPatch,
): Promise<MediaRecord | null> {
  return withIndexLock(async () => {
    const records = await readIndex();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const updated: MediaRecord = { ...records[index] };
    if ("title" in patch) updated.title = patch.title ?? null;
    if ("description" in patch) updated.description = patch.description ?? null;
    if ("takenAt" in patch) updated.takenAt = patch.takenAt ?? null;

    const next = records.slice();
    next[index] = updated;
    await writeIndex(next);
    return updated;
  });
}

/**
 * Delete a record and its stored file. Returns the removed record, or null when
 * the id is unknown.
 *
 * Consistency policy: the index entry is removed FIRST, so no listing can ever
 * point at a file that is about to disappear. If the file unlink then fails for
 * a reason other than "already missing" (ENOENT), the index is restored so the
 * metadata and disk stay consistent, and the error is re-thrown.
 */
async function remove(id: string): Promise<MediaRecord | null> {
  return withIndexLock(async () => {
    const records = await readIndex();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const record = records[index];
    const filePath = storedFilePath(record);

    const next = records.slice();
    next.splice(index, 1);
    await writeIndex(next);

    if (filePath) {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Restore the index so metadata and disk stay consistent.
          await writeIndex(records);
          throw error;
        }
      }
    }
    return record;
  });
}

/** The filesystem provider instance. */
export const filesystemMediaStore: MediaStore = {
  list,
  save,
  read,
  find,
  updateMetadata,
  remove,
};
