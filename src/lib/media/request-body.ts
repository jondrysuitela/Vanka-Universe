import { ApiError } from "@/lib/auth/guard";

/**
 * Byte-limited request body (Tahap 4G.23).
 *
 * `request.formData()` buffers the WHOLE multipart body before any size check
 * can run, so the route-level `Content-Length` test (4G.22) is only an early
 * optimization and can be bypassed by an absent or lying header.
 *
 * This wrapper inserts a counting transform between the incoming request stream
 * and the runtime's multipart parser: the parser still does all the actual
 * parsing (no hand-written multipart code), but every chunk is counted and the
 * stream errors with `413 FILE_TOO_LARGE` the moment more than `limitBytes` has
 * been read. Erroring the stream aborts the read and cancels the source, so an
 * oversized body is never fully buffered.
 *
 * Remaining bound: an ACCEPTED body is still materialized in memory by
 * `formData()` (the Web FormData API has no streaming target), but never more
 * than `limitBytes`. The cap — not a header — is what stops unbounded growth.
 */
export function limitRequestBody(request: Request, limitBytes: number): Request {
  const body = request.body;
  if (!body) return request;

  let seen = 0;
  const limited = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limitBytes) {
          controller.error(new ApiError(413, "FILE_TOO_LARGE", "Ukuran unggahan terlalu besar."));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  // A stream body requires `duplex: "half"`; the DOM lib type omits it here.
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: limited,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
