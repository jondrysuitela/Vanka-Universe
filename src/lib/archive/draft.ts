/**
 * Private archive ("Tentang Ibumu") draft store.
 *
 * There is NO server/DB persistence for private-archive configuration in this
 * project yet, so this is BROWSER-ONLY (localStorage) — an honest local draft.
 * These functions are pure and side-effect-free apart from the passed-in
 * storage, which makes them testable without a DOM.
 */

export const ARCHIVE_DRAFT_KEY = "vanka.private-archive.draft.v1";

export interface PrivateArchiveDraft {
  /** Archive title. */
  title: string;
  /** Narrative / biography text. Paragraphs separated by blank lines. */
  narrative: string;
  /** Whether private-archive music is enabled. */
  musicEnabled: boolean;
  /** Path/URL to a real audio asset, or "" when none is selected. */
  musicSrc: string;
}

export const EMPTY_ARCHIVE_DRAFT: PrivateArchiveDraft = {
  title: "",
  narrative: "",
  musicEnabled: false,
  musicSrc: "",
};

function isFiniteString(value: unknown): value is string {
  return typeof value === "string";
}

/** Parse an untrusted value into a well-formed draft (never throws). */
export function coerceArchiveDraft(value: unknown): PrivateArchiveDraft {
  if (!value || typeof value !== "object") return { ...EMPTY_ARCHIVE_DRAFT };
  const record = value as Record<string, unknown>;
  return {
    title: isFiniteString(record.title) ? record.title : "",
    narrative: isFiniteString(record.narrative) ? record.narrative : "",
    musicEnabled: record.musicEnabled === true,
    musicSrc: isFiniteString(record.musicSrc) ? record.musicSrc : "",
  };
}

export function loadArchiveDraft(): PrivateArchiveDraft {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_DRAFT_KEY);
    if (!raw) return { ...EMPTY_ARCHIVE_DRAFT };
    return coerceArchiveDraft(JSON.parse(raw));
  } catch {
    return { ...EMPTY_ARCHIVE_DRAFT };
  }
}

export function saveArchiveDraft(draft: PrivateArchiveDraft): void {
  try {
    window.localStorage.setItem(ARCHIVE_DRAFT_KEY, JSON.stringify(coerceArchiveDraft(draft)));
  } catch {
    // Storage unavailable (private mode / quota) — the editor still holds edits.
  }
}

export function clearArchiveDraft(): void {
  try {
    window.localStorage.removeItem(ARCHIVE_DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** True when the admin has actually written any real content. */
export function hasArchiveContent(draft: PrivateArchiveDraft): boolean {
  return draft.title.trim().length > 0 || draft.narrative.trim().length > 0;
}

/** Split a narrative into non-empty paragraphs (blank-line separated). */
export function splitNarrative(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
