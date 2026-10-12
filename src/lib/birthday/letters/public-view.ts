import type { LetterSection, LetterThumbnail } from "@/components/birthday/LetterScene";
import type { BirthdayLetterRow } from "@/lib/birthday/letters/repository";

/**
 * Public projection of a birthday letter (Tahap 4G.43).
 *
 * The ADMIN draft stores an opening thumbnail whose `src` points at the private
 * media route (`/api/media/[id]`, session + role required), because that is the
 * only URL that works in the admin preview BEFORE the birthday. The PUBLIC
 * experience must never use that route: it is not date-gated and needs a
 * session, so a visitor could not load it.
 *
 * This module rewrites such a `src` to the date-gated public route
 * (`/api/birthday/gallery/media/[id]`, revealed media only). A `src` that is
 * already a plain public path (e.g. `/media/vanka-opening.jpg`) is left
 * untouched. Everything else in the letter is passed through unchanged — the
 * public read never invents or edits content.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rewrite a private admin media URL to the date-gated public one. */
export function toPublicThumbnailSrc(src: string): string {
  const trimmed = src.trim();
  const prefix = "/api/media/";
  if (!trimmed.startsWith(prefix)) return src;
  const id = trimmed.slice(prefix.length);
  if (!UUID_RE.test(id)) return src;
  return `/api/birthday/gallery/media/${id}`;
}

/** Public-safe thumbnail (rewritten `src`), or null when no thumbnail was set. */
export function toPublicThumbnail(thumbnail: LetterThumbnail | null): LetterThumbnail | null {
  if (thumbnail === null) return null;
  if (!thumbnail.src) return thumbnail;
  return { ...thumbnail, src: toPublicThumbnailSrc(thumbnail.src) };
}

export interface PublicLetter {
  title: string;
  displayDate: string;
  fullText: string;
  sections: LetterSection[];
  thumbnail: LetterThumbnail | null;
}

/** Project a stored letter row for the public experience. */
export function toPublicLetter(row: BirthdayLetterRow): PublicLetter {
  return {
    title: row.title,
    displayDate: row.display_date,
    fullText: row.full_text,
    sections: row.sections,
    thumbnail: toPublicThumbnail(row.thumbnail),
  };
}
