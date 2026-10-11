import {
  THEME_MAX_AGE,
  THEME_MIN_AGE,
  birthdayYear,
  getThemeByAge,
} from "@/lib/birthday/theme-registry";
import type {
  LetterDraft,
  LetterSection,
  LetterThumbnail,
} from "@/components/birthday/LetterScene";

/**
 * Birthday letter persistence contract (Tahap 4G.25).
 *
 * PURE and browser-agnostic. These helpers define the canonical shape used when
 * a browser-local letter draft is later imported into server persistence.
 * NOTHING here talks to a database or the network, and no function reads or
 * writes storage. The live experience keeps using localStorage; a database is
 * NOT configured (see `db/BIRTHDAY_PERSISTENCE_PLAN.md`).
 *
 * Design rules:
 *  - Validation returns errors instead of silently repairing or deleting data,
 *    so malformed local drafts are never destroyed by an automatic "recovery".
 *  - `planLetterImport` reports valid / invalid / out-of-range entries
 *    separately; the caller decides what to do (no side effects).
 *  - Ids and slugs are derived from the STATIC theme registry so an import is
 *    deterministic and can never drift by renumbering a past edition.
 */

/** localStorage key owned by `LetterScene` (mirrored here; guarded by tests). */
export const LETTERS_STORE_KEY = "vanka.letters.v2";
/** Legacy single-draft key (age-1 fallback) owned by `LetterScene`. */
export const LEGACY_LETTER_DRAFT_KEY = "vanka.letter.draft.v1";

/** Stable identity of one birthday edition / letter, derived from age. */
export interface LetterEditionIdentity {
  /** Edition age (1–17). */
  age: number;
  /** Full birthday year (birth year + age), e.g. 2026. */
  year: number;
  /** Stable registry theme id, e.g. "vanka-birthday-01". */
  editionId: string;
  /** Stable registry slug, e.g. "vanka-first-universe". */
  slug: string;
  /** Deterministic server-side letter slug, e.g. "birthday-letter-2026". */
  letterSlug: string;
}

/** Identity for an age, or `null` when the age is outside the registry. */
export function letterEditionIdentity(age: number): LetterEditionIdentity | null {
  if (!Number.isInteger(age) || age < THEME_MIN_AGE || age > THEME_MAX_AGE) return null;
  const theme = getThemeByAge(age);
  if (!theme) return null;
  const year = birthdayYear(age);
  return {
    age,
    year,
    editionId: theme.id,
    slug: theme.slug,
    letterSlug: `birthday-letter-${year}`,
  };
}

export type LetterValidation =
  | { ok: true; draft: LetterDraft }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural check of an untrusted value against `LetterDraft`.
 *
 * Never mutates or repairs. An empty-but-well-formed draft (title "" / no
 * sections) is VALID; only type/shape violations are errors.
 */
export function validateLetterDraft(value: unknown): LetterValidation {
  if (!isRecord(value)) return { ok: false, errors: ["draft bukan objek"] };

  const errors: string[] = [];

  if (typeof value.title !== "string") errors.push("title harus string");
  if (typeof value.date !== "string") errors.push("date harus string");
  if (typeof value.fullText !== "string") errors.push("fullText harus string");

  if (!Array.isArray(value.sections)) {
    errors.push("sections harus array");
  } else {
    value.sections.forEach((section, i) => {
      if (!isRecord(section)) {
        errors.push(`sections[${i}] bukan objek`);
        return;
      }
      if (typeof section.id !== "string") errors.push(`sections[${i}].id harus string`);
      if (typeof section.heading !== "string") errors.push(`sections[${i}].heading harus string`);
      if (typeof section.body !== "string") errors.push(`sections[${i}].body harus string`);
    });
  }

  const thumbnail = value.thumbnail;
  if (thumbnail !== undefined && thumbnail !== null) {
    if (!isRecord(thumbnail)) {
      errors.push("thumbnail bukan objek");
    } else {
      if (thumbnail.src !== undefined && typeof thumbnail.src !== "string") {
        errors.push("thumbnail.src harus string");
      }
      if (typeof thumbnail.alt !== "string") errors.push("thumbnail.alt harus string");
      if (thumbnail.caption !== undefined && typeof thumbnail.caption !== "string") {
        errors.push("thumbnail.caption harus string");
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, draft: value as unknown as LetterDraft };
}

/**
 * Canonical shape of a birthday letter as it would be sent to server
 * persistence. Field order is fixed so serialized output is stable.
 *
 * NOTE: `sections` and `thumbnail` have NO column in the current schema
 * (`db/schema.sql`); see `db/BIRTHDAY_PERSISTENCE_PLAN.md` for the gap and the
 * decision that is still required before a real write is possible.
 */
export interface BirthdayLetterPayload {
  editionId: string;
  slug: string;
  year: number;
  age: number;
  title: string;
  /** Human display date from the draft (NOT a DB timestamp). */
  displayDate: string;
  fullText: string;
  sections: LetterSection[];
  thumbnail: LetterThumbnail | null;
}

export function toLetterPayload(
  identity: LetterEditionIdentity,
  draft: LetterDraft,
): BirthdayLetterPayload {
  return {
    editionId: identity.editionId,
    slug: identity.letterSlug,
    year: identity.year,
    age: identity.age,
    title: draft.title,
    displayDate: draft.date,
    fullText: draft.fullText,
    sections: draft.sections,
    thumbnail: draft.thumbnail ?? null,
  };
}

export interface LetterImportEntry {
  /** Original localStorage key (the age as a string). */
  key: string;
  age: number;
  identity: LetterEditionIdentity;
  draft: LetterDraft;
}

export interface InvalidLetterEntry {
  key: string;
  errors: string[];
}

export interface LetterImportPlan {
  /** Valid entries, ascending by age. */
  entries: LetterImportEntry[];
  /** Malformed entries, kept verbatim for manual review (never dropped silently). */
  invalid: InvalidLetterEntry[];
  /** Keys that are not an integer age in 1–17. */
  outOfRange: string[];
}

/**
 * Build a non-destructive import plan from a raw `vanka.letters.v2` object.
 *
 * Pure: reads nothing, writes nothing, deletes nothing. Invalid or unknown
 * entries are REPORTED, not repaired or removed.
 */
export function planLetterImport(store: Record<string, unknown>): LetterImportPlan {
  const entries: LetterImportEntry[] = [];
  const invalid: InvalidLetterEntry[] = [];
  const outOfRange: string[] = [];

  for (const [key, value] of Object.entries(store)) {
    const age = Number(key);
    if (!Number.isInteger(age) || age < THEME_MIN_AGE || age > THEME_MAX_AGE) {
      outOfRange.push(key);
      continue;
    }
    const identity = letterEditionIdentity(age);
    if (!identity) {
      outOfRange.push(key);
      continue;
    }
    const validation = validateLetterDraft(value);
    if (!validation.ok) {
      invalid.push({ key, errors: validation.errors });
      continue;
    }
    entries.push({ key, age, identity, draft: validation.draft });
  }

  entries.sort((a, b) => a.age - b.age);
  return { entries, invalid, outOfRange };
}
