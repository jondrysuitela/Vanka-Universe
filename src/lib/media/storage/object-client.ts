import "server-only";

import { Buffer } from "node:buffer";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { readR2Config, type R2Config, type S3ClientLike } from "@/lib/media/storage/r2";

/**
 * Byte-level object storage for the database-backed media store
 * (Tahap 4G.40D-3B).
 *
 * Unlike `r2.ts` (which owns both objects AND a JSON metadata index), this
 * client deals ONLY with raw bytes. Metadata lives in Postgres.
 *
 * No public access, no presigned URLs, and keys are never returned to clients;
 * the caller always supplies a server-derived key.
 */

export interface MediaObjectClient {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Resolves to null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Cheap existence probe (no body download); false when the object is absent. */
  exists(key: string): Promise<boolean>;
  /** Idempotent: a missing object is treated as already deleted. */
  delete(key: string): Promise<void>;
}

/** 404/NoSuchKey detection that does NOT swallow a missing bucket. */
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

function createS3Client(config: R2Config): S3Client {
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

interface ObjectClientOptions {
  client?: S3ClientLike;
  config?: R2Config;
}

/**
 * Build an R2-backed `MediaObjectClient`. Tests inject `client` and `config`,
 * so neither credentials nor a live connection is required.
 */
export function createR2ObjectClient(options: ObjectClientOptions = {}): MediaObjectClient {
  const config = options.config ?? readR2Config();
  const client: S3ClientLike = options.client ?? createS3Client(config);

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      try {
        const response = (await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
        )) as { Body?: unknown };
        return await bodyToBuffer(response.Body);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        // Already gone is success: delete is idempotent.
        if (isNotFound(error)) return;
        throw error;
      }
    },
  };
}
