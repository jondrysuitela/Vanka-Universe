import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LETTERS_STORE_KEY, type LetterDraft } from "@/components/birthday/LetterScene";
import {
  MUTATION_HEADER,
  ensureEdition,
  loadLetters,
  mutationInit,
  reconcileLetter,
  saveLetter,
  saveLetterEnsuringEdition,
  saveOutcomeMessage,
  serverLetterAge,
  serverStatusNote,
  toDraftFromServer,
  toLetterBody,
  type FetchLike,
  type ServerLetter,
} from "@/lib/birthday/letter-sync";

/* ----------------------------------------------------------------------- */
/* Fake fetch                                                              */
/* ----------------------------------------------------------------------- */

interface FakeResponse {
  status: number;
  body?: unknown;
  /** When true the fetcher rejects instead of returning a Response. */
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

function serverLetter(overrides: Partial<ServerLetter> = {}): ServerLetter {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    edition_id: "22222222-2222-4222-8222-222222222222",
    year: 2026,
    title: "Untuk Vanka",
    display_date: "27 Oktober 2026",
    full_text: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: null,
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Partial<LetterDraft> = {}): LetterDraft {
  return {
    title: "Untuk Vanka",
    date: "27 Oktober 2026",
    fullText: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: undefined,
    ...overrides,
  };
}

function jsonOf(init?: RequestInit): unknown {
  return JSON.parse(String(init?.body));
}

/* ----------------------------------------------------------------------- */
/* Mutation headers & body                                                 */
/* ----------------------------------------------------------------------- */

describe("mutation contract", () => {
  it("sends JSON content-type and the custom CSRF header", () => {
    const init = mutationInit("POST", { age: 1 });
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers[MUTATION_HEADER]).toBe("1");
    expect(init.method).toBe("POST");
  });

  it("builds the exact letters body, retaining all editable fields", () => {
    const body = toLetterBody(3, {
      title: "T",
      date: "D",
      fullText: "F",
      sections: [{ id: "s1", heading: "H", body: "B" }],
      thumbnail: { src: "/media/x.jpg", alt: "alt", caption: "cap" },
    });
    expect(body).toEqual({
      age: 3,
      title: "T",
      displayDate: "D",
      fullText: "F",
      sections: [{ id: "s1", heading: "H", body: "B" }],
      thumbnail: { src: "/media/x.jpg", alt: "alt", caption: "cap" },
    });
    // Never sends status/privacy/year (server-derived).
    expect(Object.keys(body)).not.toContain("status");
    expect(Object.keys(body)).not.toContain("year");
  });

  it("toLetterBody maps an absent thumbnail to explicit null", () => {
    expect(toLetterBody(1, draft()).thumbnail).toBeNull();
  });
});

/* ----------------------------------------------------------------------- */
/* Save                                                                    */
/* ----------------------------------------------------------------------- */

describe("saveLetter", () => {
  it("returns the saved letter on success and sends the CSRF header", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 200, body: { data: serverLetter() } }]);
    const result = await saveLetter(fetcher, 1, draft());
    expect(result.status).toBe("saved");
    if (result.status === "saved") expect(result.letter.year).toBe(2026);

    expect(calls[0].url).toBe("/api/birthday/letters");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers[MUTATION_HEADER]).toBe("1");
    expect(jsonOf(calls[0].init)).toMatchObject({ age: 1, title: "Untuk Vanka" });
  });

  it("maps 5xx to unavailable (no false success)", async () => {
    const { fetcher } = fakeFetcher([{ status: 500, body: { error: { code: "INTERNAL_ERROR" } } }]);
    expect((await saveLetter(fetcher, 1, draft())).status).toBe("unavailable");
  });

  it("maps a network failure to unavailable", async () => {
    const { fetcher } = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await saveLetter(fetcher, 1, draft())).status).toBe("unavailable");
  });

  it("maps 401 and 403 to unauthorized", async () => {
    const a = fakeFetcher([{ status: 401, body: { error: { code: "UNAUTHORIZED" } } }]);
    expect((await saveLetter(a.fetcher, 1, draft())).status).toBe("unauthorized");
    const b = fakeFetcher([{ status: 403, body: { error: { code: "FORBIDDEN" } } }]);
    expect((await saveLetter(b.fetcher, 1, draft())).status).toBe("unauthorized");
  });

  it("distinguishes EDITION_NOT_FOUND from LETTER_LOCKED (both 409)", async () => {
    const missing = fakeFetcher([
      { status: 409, body: { error: { code: "EDITION_NOT_FOUND" } } },
    ]);
    expect((await saveLetter(missing.fetcher, 1, draft())).status).toBe("edition_missing");
    const locked = fakeFetcher([{ status: 409, body: { error: { code: "LETTER_LOCKED" } } }]);
    expect((await saveLetter(locked.fetcher, 1, draft())).status).toBe("locked");
  });

  it("maps LETTER_PUBLISHED (409) to the frozen state", async () => {
    const frozen = fakeFetcher([{ status: 409, body: { error: { code: "LETTER_PUBLISHED" } } }]);
    expect((await saveLetter(frozen.fetcher, 1, draft())).status).toBe("published");
  });

  it("maps 422 to validation with the server message", async () => {
    const { fetcher } = fakeFetcher([
      { status: 422, body: { error: { code: "VALIDATION_ERROR", message: "Input tidak valid." } } },
    ]);
    const result = await saveLetter(fetcher, 1, draft());
    expect(result.status).toBe("validation");
    if (result.status === "validation") expect(result.message).toBe("Input tidak valid.");
  });
});

/* ----------------------------------------------------------------------- */
/* Ensure edition                                                          */
/* ----------------------------------------------------------------------- */

describe("ensureEdition", () => {
  it("treats 201 as ready/created", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 201, body: { data: {} } }]);
    const result = await ensureEdition(fetcher, 1);
    expect(result).toEqual({ status: "ready", created: true });
    expect(jsonOf(calls[0].init)).toEqual({ age: 1 });
  });

  it("treats EDITION_EXISTS as ready without creating a duplicate", async () => {
    const { fetcher } = fakeFetcher([{ status: 409, body: { error: { code: "EDITION_EXISTS" } } }]);
    expect(await ensureEdition(fetcher, 1)).toEqual({ status: "ready", created: false });
  });

  it("maps other 409 to invalid and 422 to invalid", async () => {
    const other = fakeFetcher([{ status: 409, body: { error: { code: "SOMETHING" } } }]);
    expect((await ensureEdition(other.fetcher, 1)).status).toBe("invalid");
    const bad = fakeFetcher([{ status: 422, body: { error: { code: "VALIDATION_ERROR" } } }]);
    expect((await ensureEdition(bad.fetcher, 1)).status).toBe("invalid");
  });
});

/* ----------------------------------------------------------------------- */
/* Orchestration: create edition then save                                 */
/* ----------------------------------------------------------------------- */

describe("saveLetterEnsuringEdition", () => {
  it("creates the edition once, then saves the letter", async () => {
    const { fetcher, calls } = fakeFetcher([
      { status: 409, body: { error: { code: "EDITION_NOT_FOUND" } } },
      { status: 201, body: { data: { id: "ed" } } },
      { status: 200, body: { data: serverLetter() } },
    ]);
    const outcome = await saveLetterEnsuringEdition(fetcher, 1, draft());
    expect(outcome).toMatchObject({ status: "saved", editionCreated: true });
    expect(calls.map((c) => c.url)).toEqual([
      "/api/birthday/letters",
      "/api/birthday/editions",
      "/api/birthday/letters",
    ]);
  });

  it("handles a race where the edition already exists (no duplicate create)", async () => {
    const { fetcher, calls } = fakeFetcher([
      { status: 409, body: { error: { code: "EDITION_NOT_FOUND" } } },
      { status: 409, body: { error: { code: "EDITION_EXISTS" } } },
      { status: 200, body: { data: serverLetter() } },
    ]);
    const outcome = await saveLetterEnsuringEdition(fetcher, 1, draft());
    expect(outcome).toMatchObject({ status: "saved", editionCreated: false });
    expect(calls.filter((c) => c.url === "/api/birthday/editions")).toHaveLength(1);
  });

  it("does NOT create an edition when the first save fails as unavailable", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 500, body: {} }]);
    expect((await saveLetterEnsuringEdition(fetcher, 1, draft())).status).toBe("unavailable");
    expect(calls.some((c) => c.url === "/api/birthday/editions")).toBe(false);
  });

  it("propagates unauthorized without attempting edition creation", async () => {
    const { fetcher, calls } = fakeFetcher([{ status: 401, body: {} }]);
    expect((await saveLetterEnsuringEdition(fetcher, 1, draft())).status).toBe("unauthorized");
    expect(calls).toHaveLength(1);
  });
});

/* ----------------------------------------------------------------------- */
/* Load                                                                    */
/* ----------------------------------------------------------------------- */

describe("loadLetters", () => {
  it("returns letters on success", async () => {
    const { fetcher } = fakeFetcher([{ status: 200, body: { data: [serverLetter()] } }]);
    const result = await loadLetters(fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.letters).toHaveLength(1);
  });

  it("never mistakes a server error for an empty list", async () => {
    const { fetcher } = fakeFetcher([{ status: 500, body: {} }]);
    expect((await loadLetters(fetcher)).status).toBe("unavailable");
    const net = fakeFetcher([{ status: 0, networkError: true }]);
    expect((await loadLetters(net.fetcher)).status).toBe("unavailable");
    const bad = fakeFetcher([{ status: 200, body: { data: "nope" } }]);
    expect((await loadLetters(bad.fetcher)).status).toBe("unavailable");
  });

  it("reports unauthorized for 401/403", async () => {
    const a = fakeFetcher([{ status: 401, body: {} }]);
    expect((await loadLetters(a.fetcher)).status).toBe("unauthorized");
    const b = fakeFetcher([{ status: 403, body: {} }]);
    expect((await loadLetters(b.fetcher)).status).toBe("unauthorized");
  });
});

/* ----------------------------------------------------------------------- */
/* Reconciliation (non-destructive)                                        */
/* ----------------------------------------------------------------------- */

describe("reconcileLetter", () => {
  const server = serverLetter();

  it("flags a local-only draft as pending upload", () => {
    const r = reconcileLetter(1, draft(), null);
    expect(r).toMatchObject({ hasLocal: true, hasServer: false, localPending: true, diverged: false });
  });

  it("flags a server-only letter", () => {
    const r = reconcileLetter(1, null, server);
    expect(r).toMatchObject({ hasLocal: false, hasServer: true, serverOnly: true, diverged: false });
  });

  it("treats identical content as not diverged", () => {
    const r = reconcileLetter(1, draft(), server);
    expect(r.diverged).toBe(false);
    expect(r.localPending).toBe(false);
  });

  it("flags differing content as diverged and chooses no side", () => {
    const r = reconcileLetter(1, draft({ title: "Versi lokal" }), server);
    expect(r.diverged).toBe(true);
  });

  it("round-trips a server letter into a draft without mutation", () => {
    const s = serverLetter({ thumbnail: { alt: "a", caption: "c" } });
    const d = toDraftFromServer(s);
    expect(d.title).toBe(s.title);
    expect(d.date).toBe(s.display_date);
    expect(d.fullText).toBe(s.full_text);
    expect(d.thumbnail).toEqual(s.thumbnail);
  });

  it("maps a server letter year to its registry age", () => {
    expect(serverLetterAge(serverLetter({ year: 2026 }))).toBe(1);
    expect(serverLetterAge(serverLetter({ year: 2027 }))).toBe(2);
    expect(serverLetterAge(serverLetter({ year: 1999 }))).toBeNull();
  });
});

/* ----------------------------------------------------------------------- */
/* Honest messages                                                         */
/* ----------------------------------------------------------------------- */

describe("honest messaging", () => {
  it("only reports success for a real save", () => {
    expect(saveOutcomeMessage({ status: "saved", letter: serverLetter(), editionCreated: false }, 1).type).toBe(
      "success",
    );
    for (const outcome of [
      { status: "unavailable" },
      { status: "unauthorized" },
      { status: "locked" },
      { status: "published" },
      { status: "validation", message: "x" },
    ] as const) {
      expect(saveOutcomeMessage(outcome as never, 1).type).toBe("error");
    }
  });

  it("explains the freeze for a published edition", () => {
    const msg = saveOutcomeMessage({ status: "published" }, 1);
    expect(msg.type).toBe("error");
    expect(msg.message.toLowerCase()).toContain("dibekukan");
    expect(msg.message.toLowerCase()).toContain("tidak dikirim");
  });

  it("never claims server persistence when unavailable", () => {
    const msg = saveOutcomeMessage({ status: "unavailable" }, 1);
    expect(msg.message.toLowerCase()).toContain("belum tersimpan");
    expect(msg.message.toLowerCase()).toContain("lokal");
  });

  it("status notes are honest for each state", () => {
    expect(serverStatusNote("unavailable").tone).toBe("error");
    expect(serverStatusNote("unavailable").text.toLowerCase()).toContain("belum tersedia");
    expect(serverStatusNote("unauthorized").tone).toBe("warn");
    expect(serverStatusNote("ok", 2).text).toContain("2 surat");
    expect(serverStatusNote("checking").tone).toBe("info");
  });
});

/* ----------------------------------------------------------------------- */
/* localStorage preservation                                               */
/* ----------------------------------------------------------------------- */

describe("localStorage preservation", () => {
  const removeItem = vi.fn();
  const setItem = vi.fn();
  const getItem = vi.fn((key: string) =>
    key === LETTERS_STORE_KEY
      ? JSON.stringify({ "1": { title: "lokal", date: "", fullText: "", sections: [] } })
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
      { status: 200, body: { data: [serverLetter()] } },
      { status: 409, body: { error: { code: "EDITION_NOT_FOUND" } } },
      { status: 201, body: { data: {} } },
      { status: 200, body: { data: serverLetter() } },
    ]);

    await loadLetters(fetcher);
    await saveLetterEnsuringEdition(fetcher, 1, draft());

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
