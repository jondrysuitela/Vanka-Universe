import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { ApiError } from "@/lib/auth/guard";
import type { SessionAdmin } from "@/lib/auth/session";
import { MIME_MAP, extensionForMime, sniffMime } from "@/lib/media/storage/mime";
import type {
  MediaCollection,
  MediaMetadataPatch,
  MediaRecord,
  MediaStore,
  MediaUploadMetadata,
} from "@/lib/media/storage/types";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "@/lib/media/storage/types";

/**
 * Cloudflare R2 media provider (Tahap 4G.40D-2).
 *
 * S3-compatible access via `@aws-sdk/client-s3`. Strict isolation:
 *  - object keys are `${R2_KEY_PREFIX}${record.id}.${ext}` (default `test/`),
 *  - the metadata index is a SEPARATE object (`test/index.json` by default),
 *  - the metadata key can never match a media object key.
 *
 * Authorization boundary stays the existing authenticated proxy: this module
 * never exposes object keys, public URLs, or presigned URLs.
 *
 * NOT claimed production-ready: multi-object atomicity across the media object
 * and the metadata index does not exist in R2. See the module + `db/` notes for
 * the exact compensating actions and the residual cross-process limitation.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Basename shape of a media object: `<uuid>.<ext>`. Used to keep the metadata
 * key from colliding with any possible media key. */
const MEDIA_BASENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp|mp4)$/i;

/** Default test-only object prefix. Production must set its own explicit value. */
export const DEFAULT_TEST_PREFIX = "test/";

/** Raised for missing/malformed R2 configuration. FAIL-CLOSED: never falls back. */
export class R2ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2ConfigError";
  }
}

/** Raised while reading/parsing the metadata index object. */
export class R2IndexError extends Error {
  constructor(
    public readonly code: "INDEX_READ_FAILED" | "INDEX_CORRUPT",
    message: string,
  ) {
    super(message);
    this.name = "R2IndexError";
  }
}

/** Raised when an operation could leave the bucket inconsistent (best-effort
 * compensation failed). The message never includes object keys or credentials. */
export class R2IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2IntegrityError";
  }
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  keyPrefix: string;
  metadataKey: string;
}

/** Minimal S3 surface, so tests can inject a fake without real credentials. */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    // Never echoes the value — only the variable name.
    throw new R2ConfigError(`Missing required R2 configuration: ${name}.`);
  }
  return value.trim();
}

function normalizePrefix(raw: string): string {
  if (raw.includes("\\") || raw.includes("..")) {
    throw new R2ConfigError("R2_KEY_PREFIX must not contain backslashes or '..'.");
  }
  let prefix = raw.trim();
  while (prefix.startsWith("/")) prefix = prefix.slice(1);
  if (prefix === "") {
    throw new R2ConfigError("R2_KEY_PREFIX must not be empty.");
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function normalizeMetadataKey(raw: string): string {
  if (raw.includes("\\") || raw.includes("..")) {
    throw new R2ConfigError("R2_METADATA_KEY must not contain backslashes or '..'.");
  }
  const key = raw.trim().replace(/^\/+/, "");
  if (key === "") {
    throw new R2ConfigError("R2_METADATA_KEY must not be empty.");
  }
  const basename = key.slice(key.lastIndexOf("/") + 1);
  if (MEDIA_BASENAME_RE.test(basename)) {
    // The index would collide with a media object — refuse.
    throw new R2ConfigError("R2_METADATA_KEY must not look like a media object key.");
  }
  return key;
}

/**
 * Read and validate R2 configuration from the environment.
 *
 * Reads ONLY: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * and the optional R2_ENDPOINT / R2_KEY_PREFIX / R2_METADATA_KEY. Values are
 * never logged. Missing/malformed input throws `R2ConfigError` (fail-closed).
 */
export function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const accountId = requireEnv(env, "R2_ACCOUNT_ID");
  const accessKeyId = requireEnv(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv(env, "R2_SECRET_ACCESS_KEY");
  const bucket = requireEnv(env, "R2_BUCKET");

  if (/[\s/]/.test(bucket)) {
    throw new R2ConfigError("R2_BUCKET is malformed.");
  }

  const rawPrefix = env.R2_KEY_PREFIX?.trim() ?? "";
  const keyPrefix = rawPrefix === "" ? DEFAULT_TEST_PREFIX : normalizePrefix(rawPrefix);

  const rawMetadataKey = env.R2_METADATA_KEY?.trim() ?? "";
  const metadataKey = normalizeMetadataKey(
    rawMetadataKey === "" ? `${keyPrefix}index.json` : rawMetadataKey,
  );

  const rawEndpoint = env.R2_ENDPOINT?.trim() ?? "";
  const endpoint = rawEndpoint === "" ? `https://${accountId}.r2.cloudflarestorage.com` : rawEndpoint;

  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint, keyPrefix, metadataKey };
}

function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/** 404/NoSuchKey detection WITHOUT treating a missing bucket as an empty index. */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = err.name ?? err.Code ?? err.code;
  if (code === "NoSuchKey" || code === "NotFound") return true;
  return err.$metadata?.httpStatusCode === 404 && code !== "NoSuchBucket";
}

async function bodyToBuffer(body: unknown): Promise<Buffer | null> {
  if (body === null || body === undefined) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const transformable = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof transformable.transformToByteArray === "function") {
    return Buffer.from(await transformable.transformToByteArray());
  }
  return null;
}

function normalizeRecord(record: MediaRecord): MediaRecord {
  return {
    ...record,
    collection: record.collection ?? "birthday",
    title: typeof record.title === "string" ? record.title : null,
    description: typeof record.description === "string" ? record.description : null,
    takenAt: typeof record.takenAt === "string" ? record.takenAt : null,
  };
}

interface R2MediaOptions {
  client?: S3ClientLike;
  config?: R2Config;
}

/**
 * Build an R2-backed `MediaStore`.
 *
 * Without `options.config` the configuration is read from the environment; the
 * S3 client is created only when `options.client` is not supplied. Tests inject
 * both, so no credentials are needed.
 */
export function createR2MediaStore(options: R2MediaOptions = {}): MediaStore {
  const config = options.config ?? readR2Config();
  const client: S3ClientLike = options.client ?? createR2Client(config);
  const { bucket, keyPrefix, metadataKey } = config;

  // Server-generated object key from a validated UUID + server-determined ext.
  function objectKeyFor(id: string, mime: string): string {
    if (!UUID_RE.test(id)) {
      throw new R2IntegrityError("Refusing to build a key from an invalid media id.");
    }
    const ext = extensionForMime(mime);
    if (!ext) {
      throw new R2IntegrityError("Refusing to build a key for an unsupported MIME type.");
    }
    return `${keyPrefix}${id}.${ext}`;
  }

  async function readIndex(): Promise<MediaRecord[]> {
    let response: { Body?: unknown };
    try {
      response = (await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: metadataKey }),
      )) as { Body?: unknown };
    } catch (error) {
      // A MISSING index object is a legitimate "no media yet" state.
      if (isNotFound(error)) return [];
      throw new R2IndexError("INDEX_READ_FAILED", "Index media tidak dapat dibaca.");
    }

    const bytes = await bodyToBuffer(response.Body);
    if (bytes === null) {
      throw new R2IndexError("INDEX_READ_FAILED", "Index media tidak dapat dibaca.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new R2IndexError("INDEX_CORRUPT", "Index media rusak dan tidak dapat diurai.");
    }

    if (
      !Array.isArray(parsed) ||
      parsed.some((row) => typeof row !== "object" || row === null)
    ) {
      throw new R2IndexError("INDEX_CORRUPT", "Struktur index media tidak valid.");
    }

    return (parsed as MediaRecord[]).map(normalizeRecord);
  }

  async function writeIndex(records: MediaRecord[]): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: metadataKey,
        Body: Buffer.from(JSON.stringify(records)),
        ContentType: "application/json",
      }),
    );
  }

  /**
   * Serialize index mutations WITHIN THIS PROCESS (mirrors the filesystem
   * provider). This prevents lost updates from overlapping requests in the same
   * Node process. It CANNOT protect multiple processes/instances writing
   * concurrently — that residual limitation is documented, not hidden.
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
    const record: MediaRecord = {
      id,
      name: file.name,
      mime,
      kind: meta.kind,
      size: bytes.byteLength,
      ownerId: admin.id,
      ownerLabel: admin.name,
      createdAt: new Date().toISOString(),
      collection,
      title: metadata?.title?.trim() || null,
      description: metadata?.description?.trim() || null,
      takenAt: null,
    };

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );

    try {
      await withIndexLock(async () => {
        const records = await readIndex();
        records.unshift(record);
        await writeIndex(records);
      });
    } catch (error) {
      // Compensating action: the media object is already stored, so drop it to
      // avoid orphaning bytes the index does not reference.
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        throw new R2IntegrityError(
          "Gagal menulis index setelah upload; objek media tidak dapat dibersihkan.",
        );
      }
      throw error;
    }
    return record;
  }

  async function read(id: string): Promise<{ record: MediaRecord; data: Buffer } | null> {
    const records = await readIndex();
    const record = records.find((row) => row.id === id);
    if (!record) return null;

    const key = objectKeyFor(record.id, record.mime);
    try {
      const response = (await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )) as { Body?: unknown };
      const data = await bodyToBuffer(response.Body);
      if (data === null) return null;
      return { record, data };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function find(id: string): Promise<MediaRecord | null> {
    const records = await readIndex();
    return records.find((row) => row.id === id) ?? null;
  }

  async function list(): Promise<MediaRecord[]> {
    return readIndex();
  }

  async function updateMetadata(
    id: string,
    patch: MediaMetadataPatch,
  ): Promise<MediaRecord | null> {
    return withIndexLock(async () => {
      const records = await readIndex();
      const index = records.findIndex((row) => row.id === id);
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

  async function remove(id: string): Promise<MediaRecord | null> {
    return withIndexLock(async () => {
      const records = await readIndex();
      const index = records.findIndex((row) => row.id === id);
      if (index === -1) return null;

      const record = records[index];
      const key = objectKeyFor(record.id, record.mime);

      const next = records.slice();
      next.splice(index, 1);
      await writeIndex(next);

      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) return record;
        // Compensating action: restore the index entry so metadata matches the
        // still-present object (no silent orphan either way).
        try {
          await writeIndex(records);
        } catch {
          throw new R2IntegrityError("Gagal menghapus objek dan gagal memulihkan index.");
        }
        throw error;
      }
      return record;
    });
  }

  return { list, save, read, find, updateMetadata, remove };
}

