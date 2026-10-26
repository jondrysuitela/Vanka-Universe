import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";
import {
  MediaMetadataIntegrityError,
  MediaObjectsUnavailableError,
} from "@/lib/media/db/errors";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

vi.mock("@/lib/media/store", () => ({
  // Deliberately small so the REAL streaming enforcement can be exercised with
  // cheap synthetic bodies. The production value is 50 MiB + 1 MiB (store.ts).
  MAX_REQUEST_BYTES: 4096,
  listMedia: vi.fn(),
  saveMediaUpload: vi.fn(),
  readMediaFile: vi.fn(),
  replaceMediaImage: vi.fn(),
  findMediaRecord: vi.fn(),
  updateMediaMetadata: vi.fn(),
  deleteMedia: vi.fn(),
  createDirectMediaUpload: vi.fn(),
  completeDirectMediaUpload: vi.fn(),
}));

vi.mock("@/lib/media/references", () => ({
  checkMediaReferences: vi.fn(),
  // Registered by the gallery probe module imported for side effects by the
  // DELETE route (Tahap 4G.39D). Kept as a no-op here.
  registerMediaReferenceProbe: vi.fn(),
}));

import { GET as listGet, POST as listPost } from "@/app/api/media/route";
import { POST as directUploadPost } from "@/app/api/media/direct-upload/route";
import {
  DELETE as detailDelete,
  GET as detailGet,
  PATCH as detailPatch,
  PUT as detailPut,
} from "@/app/api/media/[id]/route";
import { checkMediaReferences } from "@/lib/media/references";
import {
  MAX_REQUEST_BYTES,
  deleteMedia,
  createDirectMediaUpload,
  completeDirectMediaUpload,
  findMediaRecord,
  listMedia,
  readMediaFile,
  replaceMediaImage,
  saveMediaUpload,
  updateMediaMetadata,
} from "@/lib/media/store";

const BASE = "https://vanka.test";
const ADMIN_ID = "admin-owner";
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_UUID = "22222222-2222-4222-8222-222222222222";

type Fake = ReturnType<typeof createFakePool>;

function adminRow(role = "owner") {
  return {
    id: ADMIN_ID,
    email: "admin@vanka.test",
    name: "Admin Owner",
    role,
    is_active: true,
    session_id: "sess-1",
  };
}

function mediaRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    name: "foto.png",
    mime: "image/png",
    kind: "image",
    size: 128,
    ownerId: ADMIN_ID,
    ownerLabel: "Admin Owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    collection: "birthday",
    title: null,
    description: null,
    takenAt: null,
    ...overrides,
  };
}

function setupSession(fake: Fake, authed: boolean, role = "owner") {
  fake.when("UPDATE sessions", () => ({ rows: [], rowCount: 1 }));
  fake.when("WITH renewed AS", () => ({
    rows: authed ? [adminRow(role)] : [],
    rowCount: authed ? 1 : 0,
  }));
}

/** Headers for the multipart upload endpoint (Content-Type is set by FormData). */
function uploadHeaders(cookie?: string): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("x-vanka-request", "1");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

function uploadBody(): FormData {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "foto.png", { type: "image/png" }));
  return form;
}

function uploadBodyWithCollection(collection: string): FormData {
  const form = uploadBody();
  form.append("collection", collection);
  return form;
}

function uploadBodyWithMetadata(title: string, description: string): FormData {
  const form = uploadBody();
  form.append("title", title);
  form.append("description", description);
  return form;
}

function mutationHeaders(cookie?: string): Headers {
  const headers = new Headers();
  headers.set("origin", BASE);
  headers.set("content-type", "application/json");
  headers.set("x-vanka-request", "1");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

const COOKIE = "vanka_session=token-owner";

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

let fake: Fake;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

describe("PATCH /api/media/[id] (edit metadata)", () => {
  it("requires a session (401)", async () => {
    setupSession(fake, false);
    const res = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("rejects a missing CSRF/origin header (403)", async () => {
    setupSession(fake, true);
    const res = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: new Headers({ "content-type": "application/json", "x-vanka-request": "1" }),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    setupSession(fake, true);
    const res = await detailPatch(
      new Request(`${BASE}/api/media/not-a-uuid`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({ code: "INVALID_ID" });
  });

  it("returns 404 when the media does not exist", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(null);
    const res = await detailPatch(
      new Request(`${BASE}/api/media/${UNKNOWN_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ title: "X" }),
      }),
      { params: Promise.resolve({ id: UNKNOWN_UUID }) },
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("rejects an empty body (422) and invalid JSON (400)", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);

    const empty = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(empty.status).toBe(422);

    const badJson = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: "{not json",
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(badJson.status).toBe(400);
    expect((await json(badJson)).error).toMatchObject({ code: "INVALID_JSON" });
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("rejects forbidden keys such as id/ownerId/createdAt (422)", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    for (const extra of [{ id: "hacker" }, { ownerId: "hacker" }, { createdAt: "2020-01-01" }, { mime: "x" }]) {
      const res = await detailPatch(
        new Request(`${BASE}/api/media/${VALID_UUID}`, {
          method: "PATCH",
          headers: mutationHeaders(COOKIE),
          body: JSON.stringify({ title: "T", ...extra }),
        }),
        { params: Promise.resolve({ id: VALID_UUID }) },
      );
      expect(res.status, JSON.stringify(extra)).toBe(422);
    }
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("updates metadata and returns the record", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(updateMediaMetadata).mockResolvedValue(
      mediaRecord({ title: "Pantai", takenAt: "2026-01-02" }) as never,
    );

    const res = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ title: "Pantai", takenAt: "2026-01-02" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ id: VALID_UUID, title: "Pantai" });
    expect(vi.mocked(updateMediaMetadata)).toHaveBeenCalledWith(VALID_UUID, {
      title: "Pantai",
      takenAt: "2026-01-02",
    });
  });
});

describe("PUT /api/media/[id] (replace image)", () => {
  it("requires an authenticated media operator", async () => {
    setupSession(fake, false);
    const res = await detailPut(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PUT",
        headers: uploadHeaders(COOKIE),
        body: uploadBody(),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(replaceMediaImage)).not.toHaveBeenCalled();
  });

  it("rejects a missing multipart CSRF header", async () => {
    setupSession(fake, true);
    const res = await detailPut(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PUT",
        headers: new Headers({ origin: BASE }),
        body: uploadBody(),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(replaceMediaImage)).not.toHaveBeenCalled();
  });

  it("replaces the bytes for the existing media id", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(replaceMediaImage).mockResolvedValue(mediaRecord({ size: 4 }) as never);

    const res = await detailPut(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PUT",
        headers: uploadHeaders(COOKIE),
        body: uploadBody(),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );

    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ id: VALID_UUID, size: 4 });
    expect(replaceMediaImage).toHaveBeenCalledWith(VALID_UUID, expect.any(File));
  });
});

describe("DELETE /api/media/[id]", () => {
  it("requires a session (401)", async () => {
    setupSession(fake, false);
    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(401);
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("rejects a missing CSRF header (403)", async () => {
    setupSession(fake, true);
    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "DELETE",
        headers: new Headers({ origin: BASE, "content-type": "application/json" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-UUID id", async () => {
    setupSession(fake, true);
    const res = await detailDelete(
      new Request(`${BASE}/api/media/nope`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the media does not exist", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(null);
    const res = await detailDelete(
      new Request(`${BASE}/api/media/${UNKNOWN_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: UNKNOWN_UUID }) },
    );
    expect(res.status).toBe(404);
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("refuses to delete a still-referenced media (409 CONFLICT) and never removes it", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(checkMediaReferences).mockResolvedValue({
      verdict: "referenced",
      references: [{ source: "content", detail: "Konten ulang tahun" }],
    });

    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "CONFLICT" });
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("fails closed when references cannot be verified (409 REFERENCE_UNVERIFIED)", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(checkMediaReferences).mockResolvedValue({
      verdict: "unverifiable",
      reason: "Tidak ada sumber referensi yang terdaftar.",
    });

    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({ code: "REFERENCE_UNVERIFIED" });
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced media (verified clear)", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(checkMediaReferences).mockResolvedValue({ verdict: "clear" });
    vi.mocked(deleteMedia).mockResolvedValue(mediaRecord() as never);

    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ id: VALID_UUID });
    expect(vi.mocked(deleteMedia)).toHaveBeenCalledWith(VALID_UUID);
  });

  it("hides internal errors behind a generic 500", async () => {
    setupSession(fake, true);
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(checkMediaReferences).mockResolvedValue({ verdict: "clear" });
    vi.mocked(deleteMedia).mockRejectedValue(new Error("ENOSPC: no space left on device"));

    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(body)).not.toContain("ENOSPC");
  });
});

describe("media role policy (4G.20)", () => {
  it("GET /api/media: 401 without session, 403 for editor, 200 for owner and admin", async () => {
    setupSession(fake, false);
    const unauthorized = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(unauthorized.status).toBe(401);
    expect(vi.mocked(listMedia)).not.toHaveBeenCalled();

    setupSession(fake, true, "editor");
    const editor = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(editor.status).toBe(403);
    expect((await json(editor)).error).toMatchObject({ code: "FORBIDDEN" });
    expect(vi.mocked(listMedia)).not.toHaveBeenCalled();

    vi.mocked(listMedia).mockResolvedValue([mediaRecord()] as never);
    for (const role of ["owner", "admin"] as const) {
      setupSession(fake, true, role);
      const ok = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
      expect(ok.status, role).toBe(200);
      expect((await json(ok)).data).toEqual([mediaRecord()]);
    }
  });

  it("GET /api/media/[id]: editor denied 403 without reading the file; owner streams 200", async () => {
    setupSession(fake, true, "editor");
    const denied = await detailGet(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { headers: { cookie: COOKIE } }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(denied.status).toBe(403);
    expect(vi.mocked(readMediaFile)).not.toHaveBeenCalled();

    setupSession(fake, true, "owner");
    vi.mocked(readMediaFile).mockResolvedValue({
      record: mediaRecord(),
      data: new Uint8Array([1, 2, 3]),
    } as never);
    const ok = await detailGet(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { headers: { cookie: COOKIE } }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(ok.status).toBe(200);
    expect(vi.mocked(readMediaFile)).toHaveBeenCalledWith(VALID_UUID);
  });

  it("POST /api/media: editor denied 403 and the store is never touched", async () => {
    setupSession(fake, true, "editor");
    const res = await listPost(
      new Request(`${BASE}/api/media`, { method: "POST", headers: uploadHeaders(COOKIE), body: uploadBody() }),
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });

  it("POST /api/media: owner and admin may upload (201)", async () => {
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);
    for (const role of ["owner", "admin"] as const) {
      setupSession(fake, true, role);
      const res = await listPost(
        new Request(`${BASE}/api/media`, { method: "POST", headers: uploadHeaders(COOKIE), body: uploadBody() }),
      );
      expect(res.status, role).toBe(201);
    }
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledTimes(2);
  });

  it("direct archive upload: creates an authorized presigned plan", async () => {
    setupSession(fake, true);
    vi.mocked(createDirectMediaUpload).mockResolvedValue({
      id: VALID_UUID,
      url: "https://r2.example/signed",
      headers: { "Content-Type": "video/mp4" },
    });
    const res = await directUploadPost(
      new Request(`${BASE}/api/media/direct-upload`, {
        method: "POST",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({
          action: "create",
          name: "memory.mp4",
          mime: "video/mp4",
          size: 1024,
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(vi.mocked(createDirectMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      {
        name: "memory.mp4",
        mime: "video/mp4",
        size: 1024,
        collection: "archive",
      },
    );
  });

  it("direct archive upload: rejects editors before touching storage", async () => {
    setupSession(fake, true, "editor");
    const res = await directUploadPost(
      new Request(`${BASE}/api/media/direct-upload`, {
        method: "POST",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({
          action: "create",
          name: "memory.mp4",
          mime: "video/mp4",
          size: 1024,
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(vi.mocked(createDirectMediaUpload)).not.toHaveBeenCalled();
  });

  it("direct archive upload: completes only a valid upload ID", async () => {
    setupSession(fake, true);
    vi.mocked(completeDirectMediaUpload).mockResolvedValue(mediaRecord({ collection: "archive" }) as never);
    const res = await directUploadPost(
      new Request(`${BASE}/api/media/direct-upload`, {
        method: "POST",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ action: "complete", id: VALID_UUID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(completeDirectMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      VALID_UUID,
    );
  });

  it("PATCH metadata: editor denied 403 before the body is even parsed (role in body cannot escalate)", async () => {
    setupSession(fake, true, "editor");
    const res = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        // Forged role + otherwise valid field; must change nothing.
        body: JSON.stringify({ title: "X", role: "owner" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(findMediaRecord)).not.toHaveBeenCalled();
    expect(vi.mocked(updateMediaMetadata)).not.toHaveBeenCalled();
  });

  it("PATCH metadata: admin is allowed (200)", async () => {
    setupSession(fake, true, "admin");
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(updateMediaMetadata).mockResolvedValue(mediaRecord({ title: "A" }) as never);
    const res = await detailPatch(
      new Request(`${BASE}/api/media/${VALID_UUID}`, {
        method: "PATCH",
        headers: mutationHeaders(COOKIE),
        body: JSON.stringify({ title: "A" }),
      }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
  });

  it("DELETE: editor denied 403 and never reaches the reference check or the store", async () => {
    setupSession(fake, true, "editor");
    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(checkMediaReferences)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("DELETE: admin is allowed when the reference verdict is clear (200)", async () => {
    setupSession(fake, true, "admin");
    vi.mocked(findMediaRecord).mockResolvedValue(mediaRecord() as never);
    vi.mocked(checkMediaReferences).mockResolvedValue({ verdict: "clear" });
    vi.mocked(deleteMedia).mockResolvedValue(mediaRecord() as never);
    const res = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(res.status).toBe(200);
  });

  it("an unknown role is denied everywhere with 403", async () => {
    setupSession(fake, true, "superuser");
    const list = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(list.status).toBe(403);

    const detail = await detailDelete(
      new Request(`${BASE}/api/media/${VALID_UUID}`, { method: "DELETE", headers: mutationHeaders(COOKIE) }),
      { params: Promise.resolve({ id: VALID_UUID }) },
    );
    expect(detail.status).toBe(403);
    expect(vi.mocked(deleteMedia)).not.toHaveBeenCalled();
  });

  it("POST still enforces CSRF: missing custom header is 403 even for an owner", async () => {
    setupSession(fake, true, "owner");
    const headers = uploadHeaders(COOKIE);
    headers.delete("x-vanka-request");
    const res = await listPost(
      new Request(`${BASE}/api/media`, { method: "POST", headers, body: uploadBody() }),
    );
    expect(res.status).toBe(403);
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });

  it("a session-verification database error yields 500 and no media access", async () => {
    fake.when("WITH renewed AS", async () => {
      throw new Error("db down");
    });
    const res = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(res.status).toBe(500);
    expect(vi.mocked(listMedia)).not.toHaveBeenCalled();
  });
});

describe("upload size guard (4G.22)", () => {
  it("rejects an oversized DECLARED upload with 413 before reading the body", async () => {
    setupSession(fake, true, "owner");
    const headers = new Headers({
      origin: BASE,
      "x-vanka-request": "1",
      "content-type": "multipart/form-data; boundary=xyz",
      cookie: COOKIE,
      "content-length": String(MAX_REQUEST_BYTES + 4096),
    });
    const request = {
      url: `${BASE}/api/media`,
      method: "POST",
      headers,
      formData: async () => {
        throw new Error("the body must not be read for an oversized upload");
      },
    } as unknown as Request;

    const res = await listPost(request);
    expect(res.status).toBe(413);
    expect((await json(res)).error).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });

  it("still accepts a normal upload with a small declared length", async () => {
    setupSession(fake, true, "admin");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);
    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBody(),
      }),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledTimes(1);
  });
});

describe("upload pool tag (4G.42B)", () => {
  it("defaults an upload with no collection to birthday and passes it through", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);

    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBody(),
      }),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      expect.any(File),
      "birthday",
    );
  });

  it("stores an archive upload into the archive pool", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord({ collection: "archive" }) as never);

    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBodyWithCollection("archive"),
      }),
    );
    expect(res.status).toBe(201);
    expect((await json(res)).data).toMatchObject({ collection: "archive" });
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      expect.any(File),
      "archive",
    );
  });

  it("rejects an unknown collection with 422 and never touches the store", async () => {
    setupSession(fake, true, "owner");
    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBodyWithCollection("hacker"),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "INVALID_COLLECTION" });
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });
});

describe("upload metadata (4G.42C)", () => {
  it("passes judul and keterangan through as upload-time metadata", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);

    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBodyWithMetadata("  Senyum pertama  ", "  Foto pagi hari  "),
      }),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      expect.any(File),
      "birthday",
      { title: "Senyum pertama", description: "Foto pagi hari" },
    );
  });

  it("omits metadata entirely when only whitespace is supplied", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);

    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBodyWithMetadata("   ", ""),
      }),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADMIN_ID }),
      expect.any(File),
      "birthday",
    );
  });

  it("rejects an overlong judul with 422 and never touches the store", async () => {
    setupSession(fake, true, "owner");
    const res = await listPost(
      new Request(`${BASE}/api/media`, {
        method: "POST",
        headers: uploadHeaders(COOKIE),
        body: uploadBodyWithMetadata("x".repeat(201), "ok"),
      }),
    );
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({ code: "TITLE_TOO_LONG" });
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });
});

const BOUNDARY = "vankaboundary";

/** Chunks of a VALID multipart body whose file part is `payloadBytes` long. */
function multipartChunks(payloadBytes: number): Uint8Array[] {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Uint8Array[] = [
    new Uint8Array(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
    ),
    new Uint8Array(png),
  ];
  let remaining = Math.max(0, payloadBytes - png.byteLength);
  while (remaining > 0) {
    const size = Math.min(8192, remaining);
    chunks.push(new Uint8Array(Buffer.alloc(size, 0x41)));
    remaining -= size;
  }
  chunks.push(new Uint8Array(Buffer.from(`\r\n--${BOUNDARY}--\r\n`)));
  return chunks;
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

/** A POST request with a streamed body (so Content-Length is absent). */
function streamedUpload(body: ReadableStream<Uint8Array>, extra: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/media`, {
    method: "POST",
    headers: new Headers({
      origin: BASE,
      "x-vanka-request": "1",
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      cookie: COOKIE,
      ...extra,
    }),
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("streaming size enforcement (4G.23)", () => {
  it("rejects an oversized streamed body with NO Content-Length", async () => {
    setupSession(fake, true, "owner");
    const request = streamedUpload(streamOf(multipartChunks(MAX_REQUEST_BYTES * 4)));
    expect(request.headers.get("content-length")).toBeNull();

    const res = await listPost(request);
    expect(res.status).toBe(413);
    expect((await json(res)).error).toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });

  it("rejects when Content-Length is smaller than the real streamed body", async () => {
    setupSession(fake, true, "owner");
    const request = streamedUpload(streamOf(multipartChunks(MAX_REQUEST_BYTES * 4)), {
      "content-length": "16",
    });

    const res = await listPost(request);
    expect(res.status).toBe(413);
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });

  it("still accepts a valid multipart upload streamed without Content-Length", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(saveMediaUpload).mockResolvedValue(mediaRecord() as never);
    const request = streamedUpload(streamOf(multipartChunks(64)));

    const res = await listPost(request);
    expect(res.status).toBe(201);
    expect(vi.mocked(saveMediaUpload)).toHaveBeenCalledTimes(1);
  });

  it("handles invalid multipart data safely without touching the store", async () => {
    setupSession(fake, true, "owner");
    const garbage = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("this is not multipart"));
        controller.close();
      },
    });

    const res = await listPost(streamedUpload(garbage));
    expect([400, 413, 422]).toContain(res.status);
    expect(vi.mocked(saveMediaUpload)).not.toHaveBeenCalled();
  });
});

describe("DB media error mapping (4G.40D-3D0)", () => {
  it("maps MediaObjectsUnavailableError to 503 (fail-closed, not an opaque 500)", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(listMedia).mockRejectedValue(new MediaObjectsUnavailableError());

    const res = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatchObject({ code: "MEDIA_STORE_NOT_MIGRATED" });
  });

  it("maps MediaMetadataIntegrityError to 500 without leaking internal details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      setupSession(fake, true, "owner");
      vi.mocked(listMedia).mockRejectedValue(
        new MediaMetadataIntegrityError("bucket=secret-bucket key=media/x.png"),
      );

      const res = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toMatchObject({ code: "MEDIA_INTEGRITY_ERROR" });
      expect(JSON.stringify(body)).not.toContain("secret-bucket");
      expect(JSON.stringify(body)).not.toContain("media/x.png");
      // The safe logger must never receive the raw message/keys either.
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-bucket");
    } finally {
      spy.mockRestore();
    }
  });

  it("still hides unrelated internal errors behind the generic 500", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(listMedia).mockRejectedValue(new Error("unexpected internal"));

    const res = await listGet(new Request(`${BASE}/api/media`, { headers: { cookie: COOKIE } }));
    expect(res.status).toBe(500);
    expect((await json(res)).error).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("GET /api/media/[id] — Range proxy (4G.40D-4)", () => {
  function withBytes(bytes: number[]): void {
    vi.mocked(readMediaFile).mockResolvedValue({
      record: mediaRecord(),
      data: new Uint8Array(bytes),
    } as never);
  }

  function get(range?: string): Promise<Response> {
    const headers: Record<string, string> = { cookie: COOKIE };
    if (range) headers.range = range;
    return detailGet(new Request(`${BASE}/api/media/${VALID_UUID}`, { headers }), {
      params: Promise.resolve({ id: VALID_UUID }),
    });
  }

  it("serves the whole object with 200 when no Range is requested", async () => {
    setupSession(fake, true, "owner");
    withBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("10");
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns 206 with Content-Range for a byte range", async () => {
    setupSession(fake, true, "owner");
    withBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const res = await get("bytes=0-3");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-3/10");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3]));
  });

  it("returns 416 for a start beyond the end", async () => {
    setupSession(fake, true, "owner");
    withBytes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const res = await get("bytes=999999-");
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("maps a store failure on GET to the 503 descriptor", async () => {
    setupSession(fake, true, "owner");
    vi.mocked(readMediaFile).mockRejectedValue(new MediaObjectsUnavailableError());

    const res = await get();
    expect(res.status).toBe(503);
    expect((await json(res)).error).toMatchObject({ code: "MEDIA_STORE_NOT_MIGRATED" });
  });
});
