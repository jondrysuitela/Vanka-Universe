import { hasArchiveContent, type PrivateArchiveDraft } from "@/lib/archive/draft";

/**
 * Private-archive server sync (Tahap 4G.33).
 *
 * PURE decision layer for the admin "Arsip Privat" page. It performs NO storage
 * access and NO rendering; the caller injects a `fetch`-like function. Every
 * network outcome maps to an explicit, honest result so the UI can never show a
 * false save-success and never silently falls back to localStorage after a
 * failed server write.
 *
 * Contracts (from the implemented API):
 *  - GET /api/archive -> { data: ServerArchive | null }
 *  - PUT /api/archive -> { data: ServerArchive } | 409-less; 422 VALIDATION_ERROR
 *                        | 422 AUDIO_NOT_SUPPORTED
 *  - errors           -> { error: { code, message, details? } }
 *
 * The archive is ALWAYS private (no `privacy` field; session + role enforced
 * server-side). This module never sends `musicSrc` (a path/URL), `status`, or
 * `slug`. `musicMediaId` is `null` unless a future, verifiable private-audio
 * reference exists; today none does, so audio stays disabled.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Custom CSRF header required by `assertSafeMutation` on the server. */
export const MUTATION_HEADER = "x-vanka-request";

export interface ServerArchive {
  id: string;
  slug: string;
  title: string;
  narrative: string;
  music_enabled: boolean;
  music_media_id: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Request headers for a JSON mutation matching the server's CSRF contract. */
export function mutationInit(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
      [MUTATION_HEADER]: "1",
    },
    body: JSON.stringify(body),
  };
}

/** Exact body accepted by `PUT /api/archive` (see archive/schema.ts). */
export interface ArchiveRequestBody {
  title: string;
  narrative: string;
  musicEnabled: boolean;
  musicMediaId: string | null;
}

/**
 * Build the PUT body. `musicSrc` is deliberately dropped: private audio may only
 * reference a validated media id, and none is available today, so the reference
 * is always `null`.
 */
export function toArchiveBody(
  draft: PrivateArchiveDraft,
  musicMediaId: string | null = null,
): ArchiveRequestBody {
  return {
    title: draft.title,
    narrative: draft.narrative,
    musicEnabled: draft.musicEnabled,
    musicMediaId,
  };
}

/** Map a stored archive to an editor draft. Never invents a music path. */
export function toDraftFromServer(archive: ServerArchive): PrivateArchiveDraft {
  return {
    title: archive.title,
    narrative: archive.narrative,
    musicEnabled: archive.music_enabled,
    // The server never stores a filesystem path/URL; audio stays unconfigured.
    musicSrc: "",
  };
}

/** Human explanation of the current audio limitation (no playback faked). */
export const AUDIO_LIMITATION_TEXT =
  "Pemilihan musik belum tersedia: belum ada jalur media bertipe 'audio' yang dapat diverifikasi, dan " +
  "path/URL file tidak disimpan. Karena itu tidak ada audio yang diatur atau diputar.";

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

function isServerArchive(value: unknown): value is ServerArchive {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.narrative === "string" &&
    typeof v.music_enabled === "boolean"
  );
}

/* ----------------------------------------------------------------------- */
/* Load                                                                    */
/* ----------------------------------------------------------------------- */

export type LoadArchiveResult =
  | { status: "ok"; archive: ServerArchive | null }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/**
 * Load the server archive. NEVER throws and NEVER touches localStorage. A
 * 5xx/network failure is `unavailable` (never reported as "no archive").
 */
export async function loadArchive(fetcher: FetchLike): Promise<LoadArchiveResult> {
  let res: Response;
  try {
    res = await fetcher("/api/archive", { headers: { accept: "application/json" } });
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (!res.ok) return { status: "unavailable" };
  const data = (await readJson(res) as { data?: unknown } | null)?.data;
  if (data === null || data === undefined) return { status: "ok", archive: null };
  if (!isServerArchive(data)) return { status: "unavailable" };
  return { status: "ok", archive: data };
}

/* ----------------------------------------------------------------------- */
/* Save                                                                    */
/* ----------------------------------------------------------------------- */

export type SaveArchiveResult =
  | { status: "saved"; archive: ServerArchive }
  | { status: "validation"; message: string }
  | { status: "audio_unsupported"; message: string }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/** PUT /api/archive (draft-only; private). */
export async function saveArchive(
  fetcher: FetchLike,
  draft: PrivateArchiveDraft,
): Promise<SaveArchiveResult> {
  let res: Response;
  try {
    res = await fetcher("/api/archive", mutationInit("PUT", toArchiveBody(draft)));
  } catch {
    return { status: "unavailable" };
  }
  if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
  if (res.ok) {
    const data = (await readJson(res) as { data?: unknown } | null)?.data;
    if (!isServerArchive(data)) return { status: "unavailable" };
    return { status: "saved", archive: data };
  }
  if (res.status === 422) {
    const { code, message } = errorInfo(await readJson(res));
    if (code === "AUDIO_NOT_SUPPORTED") {
      return { status: "audio_unsupported", message: message || AUDIO_LIMITATION_TEXT };
    }
    return { status: "validation", message: message || "Input tidak valid." };
  }
  return { status: "unavailable" };
}

/* ----------------------------------------------------------------------- */
/* Non-destructive reconciliation                                          */
/* ----------------------------------------------------------------------- */

export interface ArchiveReconciliation {
  /** Local draft holds real content (title/narrative) or enables music. */
  hasLocal: boolean;
  hasServer: boolean;
  /** Local content exists but no server archive yet — needs explicit upload. */
  localPending: boolean;
  /** Server archive exists but local draft is empty. */
  serverOnly: boolean;
  /** Both exist and their shared fields differ — do NOT silently pick one. */
  diverged: boolean;
}

export function localArchiveHasContent(draft: PrivateArchiveDraft): boolean {
  return hasArchiveContent(draft) || draft.musicEnabled;
}

function sameFields(local: PrivateArchiveDraft, server: ServerArchive): boolean {
  // `musicSrc` is intentionally excluded: the server never stores a path/URL.
  return (
    local.title === server.title &&
    local.narrative === server.narrative &&
    local.musicEnabled === server.music_enabled
  );
}

/**
 * Compare a local draft with the server archive. Pure: reports state, overwrites
 * nothing. When both exist and differ, the UI must surface the divergence.
 */
export function reconcileArchive(
  local: PrivateArchiveDraft,
  server: ServerArchive | null,
): ArchiveReconciliation {
  const hasLocal = localArchiveHasContent(local);
  const hasServer = server != null;
  return {
    hasLocal,
    hasServer,
    localPending: hasLocal && !hasServer,
    serverOnly: !hasLocal && hasServer,
    diverged: hasLocal && hasServer && !sameFields(local, server!),
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
export function saveArchiveMessage(result: SaveArchiveResult): UserMessage {
  switch (result.status) {
    case "saved":
      return {
        type: "success",
        title: "Tersimpan di server",
        message: "Arsip privasi tersimpan di server. Draf lokal di browser tetap ada dan tidak dihapus.",
      };
    case "validation":
      return { type: "error", title: "Input tidak valid", message: result.message };
    case "audio_unsupported":
      return { type: "error", title: "Musik belum didukung", message: result.message };
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
          "Server/database belum tersedia, jadi arsip ini BELUM tersimpan di server. Draf lokal tetap aman di browser ini.",
      };
  }
}

export type ArchiveServerStatus = "checking" | "ok" | "unauthorized" | "unavailable";

export interface StatusNote {
  tone: "info" | "warn" | "error";
  text: string;
}

/** Honest banner text for the current server state. */
export function archiveStatusNote(
  status: ArchiveServerStatus,
  hasServer: boolean,
): StatusNote {
  switch (status) {
    case "checking":
      return { tone: "info", text: "Memeriksa koneksi server…" };
    case "ok":
      return {
        tone: "info",
        text: hasServer
          ? "Terhubung. Arsip tersimpan di server. Draf lokal di browser tetap terpisah dan tidak ditimpa."
          : "Terhubung ke server. Belum ada arsip tersimpan di server; draf lokal di browser tetap aman.",
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
