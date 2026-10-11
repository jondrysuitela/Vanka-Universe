import { describe, expect, it, vi } from "vitest";

// `limitRequestBody` pulls the auth guard -> session -> db; neither a DB nor the
// Next runtime is needed here.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

import { ApiError } from "@/lib/auth/guard";
import { limitRequestBody } from "@/lib/media/request-body";

const BASE = "https://vanka.test/api/media";
const BOUNDARY = "vankaboundary";
const MULTIPART = `multipart/form-data; boundary=${BOUNDARY}`;

// A stream body requires `duplex: "half"`; the DOM lib type omits it here.
type StreamInit = RequestInit & { duplex: "half" };

/** Emits `totalBytes` bytes in `chunkSize` chunks; no Content-Length is set. */
function bodyStream(totalBytes: number, chunkSize = 8192, onCancel?: () => void): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(65));
      sent += size;
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** A VALID multipart body whose file part is `payloadBytes` long. */
function validMultipartStream(payloadBytes: number, chunkSize = 8192): ReadableStream<Uint8Array> {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts: Uint8Array[] = [
    new Uint8Array(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
    ),
    new Uint8Array(png),
  ];
  let remaining = Math.max(0, payloadBytes - png.byteLength);
  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining);
    parts.push(new Uint8Array(Buffer.alloc(size, 0x41)));
    remaining -= size;
  }
  parts.push(new Uint8Array(Buffer.from(`\r\n--${BOUNDARY}--\r\n`)));

  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) {
        controller.close();
        return;
      }
      controller.enqueue(parts[i]);
      i += 1;
    },
  });
}

function postRequest(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request(BASE, {
    method: "POST",
    headers: { "content-type": MULTIPART, ...headers },
    body: stream,
    duplex: "half",
  } as StreamInit);
}

async function outcome<T>(promise: Promise<T>): Promise<T | unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

describe("limitRequestBody (4G.23)", () => {
  it("passes a body at or under the limit through untouched", async () => {
    const request = postRequest(bodyStream(4096));
    const limited = limitRequestBody(request, 4096);
    const bytes = new Uint8Array(await limited.arrayBuffer());
    expect(bytes.byteLength).toBe(4096);
  });

  it("rejects an oversized body with a 413 ApiError though Content-Length is absent", async () => {
    const request = postRequest(bodyStream(64 * 1024));
    expect(request.headers.get("content-length")).toBeNull();

    const limited = limitRequestBody(request, 4096);
    const error = await outcome(limited.arrayBuffer().then(() => undefined));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });

  it("ignores a misleading small Content-Length and still enforces the cap", async () => {
    const request = postRequest(bodyStream(64 * 1024), { "content-length": "10" });
    const limited = limitRequestBody(request, 4096);
    const error = await outcome(limited.arrayBuffer().then(() => undefined));

    expect(error).toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });

  it("surfaces the cap through formData() on a VALID multipart body", async () => {
    const request = postRequest(validMultipartStream(64 * 1024));
    const limited = limitRequestBody(request, 8192);
    const error = await outcome(limited.formData().then(() => undefined));

    expect(error).toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });

  it("accepts a valid multipart body under the cap", async () => {
    const request = postRequest(validMultipartStream(1024));
    const limited = limitRequestBody(request, 8192);
    const form = await limited.formData();
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(1024);
  });

  it("returns a body-less request untouched", () => {
    const request = new Request(BASE, { method: "POST" });
    expect(limitRequestBody(request, 4096)).toBe(request);
  });

  it("propagates a source stream failure instead of hiding it", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16));
        controller.error(new Error("network failure"));
      },
    });
    const limited = limitRequestBody(postRequest(failing), 4096);
    await expect(limited.arrayBuffer()).rejects.toThrow("network failure");
  });

  it("aborts the source stream once the cap is exceeded (no further reading)", async () => {
    const onCancel = vi.fn();
    const limited = limitRequestBody(postRequest(bodyStream(10_000_000, 64 * 1024, onCancel)), 4096);
    const error = await outcome(limited.arrayBuffer().then(() => undefined));

    expect(error).toMatchObject({ status: 413 });
    expect(onCancel).toHaveBeenCalled();
  });
});
