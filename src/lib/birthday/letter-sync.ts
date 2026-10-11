import type { LetterDraft, LetterSection, LetterThumbnail } from "@/components/birthday/LetterScene";
import { BIRTHDAY_THEMES } from "@/lib/birthday/theme-registry";

/**
 * Birthday-letter server sync (Tahap 4G.32).
 *
 * PURE decision layer for the admin "Tulis Surat" page. It performs NO storage
 * access and NO rendering; the caller injects a `fetch`-like function. All
 * network outcomes are mapped to explicit, honest results so the UI can never
 * show a false save-success and never silently falls back to localStorage after
 * a failed server write.
 *
 * Contracts (from the implemented APIs):
 *  - GET  /api/birthday/letters        -> { data: ServerLetter[] }
 *  - POST /api/birthday/editions       -> 201 { data } | 409 EDITION_EXISTS
 *  - POST /api/birthday/letters        -> 200 { data } | 409 EDITION_NOT_FOUND | 409 LETTER_LOCKED
 *  - errors                            -> { error: { code, message, details? } }
 *
 * Writes are DRAFT-ONLY: this module never calls any publish workflow and never
 * sends `status`/`privacy`/`year`. It also never touches localStorage.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Custom CSRF header required by `assertSafeMutation` on the server. */
export const MUTATION_HEADER = "x-vanka-request";

export interface ServerLetter {
  id: string;
  edition_id: string;
  year: number;
  title: string;
  display_date: string;
  full_text: string;
  sections: LetterSection[];
  thumbnail: LetterThumbnail | null;
  status: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/** Request headers for a JSON mutation matching the server's CSRF contract. */
export function mutationInit(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      [MUTATION_HEADER]: "1",
    },
    body: JSON.stringify(body),
  };
}

/** Exact body accepted by `POST /api/birthday/letters` (see letters/schema.ts). */
export interface LetterRequestBody {
  age: number;
  title: string;
  displayDate: string;
  fullText: string;
  sections: LetterSection[];
  thumbnail: LetterThumbnail | null;
}

export function toLetterBody(age: number, draft: LetterDraft): LetterRequestBody {
  return {
    age,
    title: draft.title,
    displayDate: draft.date,
    fullText: draft.fullText,
    sections: draft.sections,
    thumbnail: draft.thumbnail ?? null,
  };
}

/** Map a stored letter back to an editor draft (used only on explicit request). */
export function toDraftFromServer(letter: ServerLetter): LetterDraft {
  return {
    title: letter.title,
    date: letter.display_date,
    fullText: letter.full_text,
    sections: letter.sections,
    thumbnail: letter.thumbnail ?? undefined,
  };
}

/** Edition age for a server letter, derived from the static registry (or null). */
export function serverLetterAge(letter: ServerLetter): number | null {
  const theme = BIRTHDAY_THEMES.find((t) => t.year === letter.year);
  return theme ? theme.age : null;
}

/* ----------------------------------------------------------------------- */
/* Low-level parsing                                                       */
/* ----------------------------------------------------------------------- */

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorInfo(body: unknown): { code: string; message: string } {
  const err = (body as { error?: unknown } | null)?.error;
  if (err && typeof err === "object") {
    const code =
      typeof (err as { code?: unknown }).code === "string"
        ? (err as { code: string }).code
        : "UNKNOWN";
    const message =
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
    return { code, message };
  }
  return { code: "UNKNOWN", message: "" };
}

/* ----------------------------------------------------------------------- */
/* Load                                                                    */
/* ----------------------------------------------------------------------- */

export type LoadLettersResult =
  | { status: "ok"; letters: ServerLetter[] }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/**
 * Load persisted letters. NEVER throws and NEVER touches localStorage.
 * A 5xx/network failure is reported as `unavailable` (never as an empty list,
 * so the UI cannot mistake "server down" for "no letters").
 */
export async function loadLetters(fetcher: FetchLike): Promise<LoadLettersResult> {
  let res: Response;
  try {
    res = await fetcher("/api/birthday/letters", {
      headers: { accept: "application/json" },
    });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (!res.ok) return { status: "unavailable" };
  const data = (await readJson(res) as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { status: "unavailable" };
  return { status: "ok", letters: data as ServerLetter[] };
}

/* ----------------------------------------------------------------------- */
/* Edition ensure (intentional create, only on explicit save)              */
/* ----------------------------------------------------------------------- */

export type EnsureEditionResult =
  | { status: "ready"; created: boolean }
  | { status: "unauthorized" }
  | { status: "invalid" }
  | { status: "unavailable" };

/** POST /api/birthday/editions. `EDITION_EXISTS` counts as ready (no duplicate). */
export async function ensureEdition(fetcher: FetchLike, age: number): Promise<EnsureEditionResult> {
  let res: Response;
  try {
    res = await fetcher("/api/birthday/editions", mutationInit("POST", { age }));
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (res.status === 201) return { status: "ready", created: true };
  if (res.status === 409) {
    const { code } = errorInfo(await readJson(res));
    if (code === "EDITION_EXISTS") return { status: "ready", created: false };
    return { status: "invalid" };
  }
  if (res.status === 422) return { status: "invalid" };
  return { status: "unavailable" };
}

/* ----------------------------------------------------------------------- */
/* Save                                                                    */
/* ----------------------------------------------------------------------- */

export type SaveLetterResult =
  | { status: "saved"; letter: ServerLetter }
  | { status: "edition_missing" }
  | { status: "locked" }
  | { status: "validation"; message: string }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/** POST /api/birthday/letters (draft-only). */
export async function saveLetter(
  fetcher: FetchLike,
  age: number,
  draft: LetterDraft,
): Promise<SaveLetterResult> {
  let res: Response;
  try {
    res = await fetcher("/api/birthday/letters", mutationInit("POST", toLetterBody(age, draft)));
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (res.ok) {
    const data = (await readJson(res) as { data?: unknown } | null)?.data;
    if (!data || typeof data !== "object") return { status: "unavailable" };
    return { status: "saved", letter: data as ServerLetter };
  }
  if (res.status === 422) {
    const { message } = errorInfo(await readJson(res));
    return { status: "validation", message: message || "Input tidak valid." };
  }
  if (res.status === 409) {
    const { code } = errorInfo(await readJson(res));
    if (code === "EDITION_NOT_FOUND") return { status: "edition_missing" };
    if (code === "LETTER_LOCKED") return { status: "locked" };
    return { status: "unavailable" };
  }
  return { status: "unavailable" };
}

export type ServerSaveOutcome =
  | { status: "saved"; letter: ServerLetter; editionCreated: boolean }
  | { status: "locked" }
  | { status: "validation"; message: string }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/**
 * Save a draft, creating the edition first ONLY if the letter endpoint reports
 * `EDITION_NOT_FOUND`. The edition is never created at load time, so no burst of
 * create requests can occur. `EDITION_EXISTS` is treated as success (safe
 * duplicate handling); the edition is created at most once per explicit save.
 */
export async function saveLetterEnsuringEdition(
  fetcher: FetchLike,
  age: number,
  draft: LetterDraft,
): Promise<ServerSaveOutcome> {
  const first = await saveLetter(fetcher, age, draft);
  if (first.status !== "edition_missing") return first;

  const ensured = await ensureEdition(fetcher, age);
  if (ensured.status === "unauthorized") return { status: "unauthorized" };
  if (ensured.status === "invalid") return { status: "validation", message: "Usia edisi tidak valid." };
  if (ensured.status === "unavailable") return { status: "unavailable" };

  const retry = await saveLetter(fetcher, age, draft);
  if (retry.status === "saved") {
    return { status: "saved", letter: retry.letter, editionCreated: ensured.created };
  }
  if (retry.status === "edition_missing") return { status: "unavailable" };
  return retry;
}

/* ----------------------------------------------------------------------- */
/* Non-destructive reconciliation                                          */
/* ----------------------------------------------------------------------- */

export interface LetterReconciliation {
  hasLocal: boolean;
  hasServer: boolean;
  /** Local exists but no server letter yet — needs an explicit upload. */
  localPending: boolean;
  /** Server letter exists but there is no local draft. */
  serverOnly: boolean;
  /** Both exist and their editable content differs — do NOT silently pick one. */
  diverged: boolean;
}

function sameDraftContent(age: number, local: LetterDraft, server: ServerLetter): boolean {
  const body = toLetterBody(age, local);
  return (
    body.title === server.title &&
    body.displayDate === server.display_date &&
    body.fullText === server.full_text &&
    JSON.stringify(body.sections) === JSON.stringify(server.sections) &&
    JSON.stringify(body.thumbnail) === JSON.stringify(server.thumbnail)
  );
}

/**
 * Compare a local draft with the server letter for the same age.
 * Pure: reports state, overwrites nothing. When both exist and differ, the UI
 * must surface the divergence and let the user decide (never auto-merge).
 */
export function reconcileLetter(
  age: number,
  local: LetterDraft | null,
  server: ServerLetter | null,
): LetterReconciliation {
  const hasLocal = local != null;
  const hasServer = server != null;
  return {
    hasLocal,
    hasServer,
    localPending: hasLocal && !hasServer,
    serverOnly: !hasLocal && hasServer,
    diverged: hasLocal && hasServer && !sameDraftContent(age, local!, server!),
  };
}

/* ----------------------------------------------------------------------- */
/* Honest user-facing messages                                             */
/* ----------------------------------------------------------------------- */

export interface UserMessage {
  title: string;
  message: string;
  type: "info" | "success" | "error";
}

/**
 * Message for a save attempt. `type` is `"success"` ONLY for `saved`; every
 * failure path is `"error"` (never a false success).
 */
export function saveOutcomeMessage(outcome: ServerSaveOutcome, age: number): UserMessage {
  switch (outcome.status) {
    case "saved":
      return {
        type: "success",
        title: "Tersimpan di server",
        message: `Surat usia ${age} tersimpan di server${outcome.editionCreated ? " (draf edisi dibuat lebih dulu)" : ""}. Draf lokal di browser tetap ada.`,
      };
    case "validation":
      return { type: "error", title: "Input tidak valid", message: outcome.message };
    case "locked":
      return {
        type: "error",
        title: "Tidak dapat ditimpa",
        message: "Surat edisi ini sudah bukan draf dan tidak dapat ditimpa dari sini.",
      };
    case "unauthorized":
      return {
        type: "error",
        title: "Tidak berwenang",
        message: "Sesi tidak valid atau peran tidak diizinkan. Draf lokal tetap aman di browser ini.",
      };
    case "unavailable":
      return {
        type: "error",
        title: "Belum tersimpan di server",
        message:
          "Server/database belum tersedia, jadi surat ini BELUM tersimpan di server. Draf lokal tetap aman di browser ini.",
      };
  }
}

export type ServerStatus = "checking" | "ok" | "unauthorized" | "unavailable";

export interface StatusNote {
  tone: "info" | "warn" | "error";
  text: string;
}

/** Honest banner text for the current server state. */
export function serverStatusNote(status: ServerStatus, serverCount = 0): StatusNote {
  switch (status) {
    case "checking":
      return { tone: "info", text: "Memeriksa koneksi server…" };
    case "ok":
      return {
        tone: "info",
        text:
          serverCount > 0
            ? `Terhubung. ${serverCount} surat tersimpan di server. Draf lokal di browser tetap terpisah dan tidak ditimpa.`
            : "Terhubung ke server. Belum ada surat yang tersimpan di server; draf lokal di browser tetap aman.",
      };
    case "unauthorized":
      return {
        tone: "warn",
        text: "Sesi tidak valid/tidak berwenang. Draf lokal di browser tetap aman dan tetap dapat diedit.",
      };
    case "unavailable":
      return {
        tone: "error",
        text: "Server/database belum tersedia. Semua perubahan tetap draf lokal di browser ini dan BELUM tersimpan di server.",
      };
  }
}
