import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ARCHIVE_DRAFT_KEY, type PrivateArchiveDraft } from "@/lib/archive/draft";
import {
  AUDIO_LIMITATION_TEXT,
  MUTATION_HEADER,
  archiveStatusNote,
  loadArchive,
  localArchiveHasContent,
  mutationInit,
  reconcileArchive,
  saveArchive,
  saveArchiveMessage,
  toArchiveBody,
  toDraftFromServer,
  type FetchLike,
  type ServerArchive,
} from "@/lib/archive/archive-sync";

interface FakeResponse {
  status: number;
  body?: unknown;
  networkError?: boolean;
}

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetcher(script: FakeResponse[] | ((call: Call, index: number) => FakeResponse)) {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (url, init) => {
    const call: Call = { url, init };
    const index = calls.length;
    calls.push(call);
    const step = typeof script === "function" ? script(call, index) : script[index];
    if (!step) throw new Error(`no fake response for call ${index} to ${url}`);
    if (step.networkError) throw new TypeError("Failed to fetch");
    return new Response(step.body === undefined ? null : JSON.stringify(step.body), {
      status: step.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetcher, calls };
}

function serverArchive(overrides: Partial<ServerArchive> = {}): ServerArchive {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "tentang-ibumu",
    title: "Tentang Ibumu",
    narrative: "Paragraf.",
    music_enabled: false,
    music_media_id: null,
    status: "draft",
    created_by: "admin-owner",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Partial<PrivateArchiveDraft> = {}): PrivateArchiveDraft {
  return {
    title: "Tentang Ibumu",
    narrative: "Paragraf.",
    musicEnabled: false,
    musicSrc: "",
    ...overrides,
  };
}

function jsonOf(init?: RequestInit): unknown {
  return JSON.parse(String(init?.body));
}

/* ----------------------------------------------------------------------- */
/* Mutation contract                                                       */
/* ----------------------------------------------------------------------- */

describe("archive mutation contract", () => {
  it("sends JSON content-type, PUT and the custom CSRF header", () => {
    const init = mutationInit("PUT", { title: "x" });
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers[MUTATION_HEADER]).toBe("1");
    expect(init.method).toBe("PUT");
  });

  it("never sends musicSrc / status / slug — even when the local draft has musicSrc", () => {
    const body = toArchiveBody(draft({ musicSrc: "/media/ibu.mp3", musicEnabled: true }));
    expect(body).toEqual({
      title: "Tentang Ibumu",
      narrative: "Paragraf.",
      musicEnabled: true,
      musicMediaId: null,
    });
    const keys = Object.keys(body);
    for (const forbidden of ["musicSrc", "status", "slug", "privacy", "id", "created_by"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("keeps musicMediaId null (no unverifiable private-audio reference)", () => {
    expect(toArchiveBody(draft()).musicMediaId).toBeNull();
  });
});

/* ----------------------------------------------------------------------- */
/* Load                                                                    */
/* ----------------------------------------------------------------------- */

describe("loadArchive", () => {
  it("returns the archive on success", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: serverArchive() } }]);
    const result = await loadArchive(fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.archive?.slug).toBe("tentang-ibumu");
    expect(calls[0].url).toBe("/api/archive");
  });

  it("maps a null data payload to 'no archive' (not an error)", async () => {
    const { fetcher } = fakeFetcher([{ status: 200, body: { data: null } }]);
    const result = await loadArchive(fetcher);
    expect(result).toEqual({ status: "ok", archive: null });
  });

  it("never mistakes a server error for an empty archive", async () => {
    const s = fakeFetcher([{ status: 500, body: {} }]);
    expect((await loadArchive(s.fetcher)).status).toBe("unavailable");
    const n = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await loadArchive(n.fetcher)).status).toBe("unavailable");
    const bad = fakeFetcher([{ status: 200, body: { data: 42 } }]);
    expect((await loadArchive(bad.fetcher)).status).toBe("unavailable");
  });

  it("reports unauthorized for 401/403", async () => {
    const a = fakeFetcher([{ status: 401, body: {} }]);
    expect((await loadArchive(a.fetcher)).status).toBe("unauthorized");
    const b = fakeFetcher([{ status: 403, body: {} }]);
    expect((await loadArchive(b.fetcher)).status).toBe("unauthorized");
  });
});

/* ----------------------------------------------------------------------- */
/* Save                                                                    */
/* ----------------------------------------------------------------------- */

describe("saveArchive", () => {
  it("returns the saved archive and sends the CSRF header", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: serverArchive() } }]);
    const result = await saveArchive(fetcher, draft());
    expect(result.status).toBe("saved");
    expect(calls[0].url).toBe("/api/archive");
    expect((calls[0].init?.headers as Record<string, string>)[MUTATION_HEADER]).toBe("1");
    expect(jsonOf(calls[0].init)).toEqual({
      title: "Tentang Ibumu",
      narrative: "Paragraf.",
      musicEnabled: false,
      musicMediaId: null,
    });
  });

  it("maps 5xx and network failure to unavailable (no false success)", async () => {
    const s = fakeFetcher([{ status: 500, body: { error: { code: "INTERNAL_ERROR" } } }]);
    expect((await saveArchive(s.fetcher, draft())).status).toBe("unavailable");
    const n = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await saveArchive(n.fetcher, draft())).status).toBe("unavailable");
  });

  it("maps 401/403 to unauthorized", async () => {
    const a = fakeFetcher([{ status: 401, body: {} }]);
    expect((await saveArchive(a.fetcher, draft())).status).toBe("unauthorized");
    const b = fakeFetcher([{ status: 403, body: {} }]);
    expect((await saveArchive(b.fetcher, draft())).status).toBe("unauthorized");
  });

  it("maps a generic 422 to validation, and AUDIO_NOT_SUPPORTED to audio_unsupported", async () => {
    const v = fakeFetcher([
      { status: 422, body: { error: { code: "VALIDATION_ERROR", message: "Input tidak valid." } } },
    ]);
    const vr = await saveArchive(v.fetcher, draft());
    expect(vr.status).toBe("validation");

    const a = fakeFetcher([
      { status: 422, body: { error: { code: "AUDIO_NOT_SUPPORTED", message: "Audio privat belum didukung." } } },
    ]);
    const ar = await saveArchive(a.fetcher, draft());
    expect(ar.status).toBe("audio_unsupported");
    if (ar.status === "audio_unsupported") expect(ar.message).toMatch(/audio/i);
  });
});

/* ----------------------------------------------------------------------- */
/* Reconciliation                                                          */
/* ----------------------------------------------------------------------- */

describe("reconcileArchive", () => {
  it("flags a local-only draft as pending upload", () => {
    const r = reconcileArchive(draft(), null);
    expect(r).toMatchObject({ hasLocal: true, hasServer: false, localPending: true, diverged: false });
  });

  it("flags a server-only archive when the local draft is empty", () => {
    const r = reconcileArchive({ title: "", narrative: "", musicEnabled: false, musicSrc: "" }, serverArchive());
    expect(r).toMatchObject({ hasLocal: false, hasServer: true, serverOnly: true, diverged: false });
  });

  it("treats identical fields as not diverged", () => {
    const r = reconcileArchive(draft(), serverArchive());
    expect(r.diverged).toBe(false);
    expect(r.localPending).toBe(false);
  });

  it("flags differing content as diverged and chooses no side", () => {
    const r = reconcileArchive(draft({ narrative: "Versi lokal" }), serverArchive());
    expect(r.diverged).toBe(true);
  });

  it("ignores musicSrc for divergence (never a server field)", () => {
    const r = reconcileArchive(draft({ musicSrc: "/x.mp3" }), serverArchive());
    expect(r.diverged).toBe(false);
  });

  it("treats musicEnabled-only drafts as local content", () => {
    expect(localArchiveHasContent({ title: "", narrative: "", musicEnabled: true, musicSrc: "" })).toBe(true);
  });

  it("maps a server archive to a draft without inventing a music path", () => {
    const d = toDraftFromServer(serverArchive({ music_enabled: true }));
    expect(d).toEqual({ title: "Tentang Ibumu", narrative: "Paragraf.", musicEnabled: true, musicSrc: "" });
  });
});

/* ----------------------------------------------------------------------- */
/* Honest messages & audio limitation                                      */
/* ----------------------------------------------------------------------- */

describe("honest messaging", () => {
  it("only reports success for a real save", () => {
    expect(saveArchiveMessage({ status: "saved", archive: serverArchive() }).type).toBe("success");
    for (const result of [
      { status: "unavailable" },
      { status: "unauthorized" },
      { status: "validation", message: "x" },
      { status: "audio_unsupported", message: "y" },
    ] as const) {
      expect(saveArchiveMessage(result as never).type).toBe("error");
    }
  });

  it("never claims server persistence when unavailable", () => {
    const msg = saveArchiveMessage({ status: "unavailable" });
    expect(msg.message.toLowerCase()).toContain("belum tersimpan");
    expect(msg.message.toLowerCase()).toContain("lokal");
  });

  it("states the audio limitation plainly", () => {
    expect(AUDIO_LIMITATION_TEXT.toLowerCase()).toContain("musik");
    expect(AUDIO_LIMITATION_TEXT.toLowerCase()).toContain("belum");
  });

  it("status notes are honest for each state", () => {
    expect(archiveStatusNote("unavailable", false).tone).toBe("error");
    expect(archiveStatusNote("unavailable", false).text.toLowerCase()).toContain("belum tersedia");
    expect(archiveStatusNote("unauthorized", false).tone).toBe("warn");
    expect(archiveStatusNote("ok", true).text.toLowerCase()).toContain("arsip tersimpan");
    expect(archiveStatusNote("checking", false).tone).toBe("info");
  });
});

/* ----------------------------------------------------------------------- */
/* localStorage preservation                                               */
/* ----------------------------------------------------------------------- */

describe("localStorage preservation", () => {
  const removeItem = vi.fn();
  const setItem = vi.fn();
  const getItem = vi.fn((key: string) =>
    key === ARCHIVE_DRAFT_KEY
      ? JSON.stringify({ title: "lokal", narrative: "n", musicEnabled: false, musicSrc: "" })
      : null,
  );

  beforeEach(() => {
    removeItem.mockClear();
    setItem.mockClear();
    vi.stubGlobal("window", { localStorage: { getItem, setItem, removeItem } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("performs no storage writes during load or save flows", async () => {
    const { fetcher } = fakeFetcher([
      { status: 200, body: { data: serverArchive() } },
      { status: 200, body: { data: serverArchive() } },
    ]);

    await loadArchive(fetcher);
    await saveArchive(fetcher, draft());

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
