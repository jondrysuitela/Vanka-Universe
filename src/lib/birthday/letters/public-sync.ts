/**
 * Birthday-letter PUBLIC client sync (Tahap 4G.43) — browser-side decision layer.
 *
 * PURE: performs no rendering and no storage; the caller injects a `fetch`-like
 * function. Outcomes are mapped to explicit, honest results so the experience UI
 * can never mistake "gate still locked" or "server down" for "no letter".
 *
 * Contract (implemented in `src/app/api/birthday/letter/route.ts`):
 *  - public GET /api/birthday/letter        -> 200 { data } | 403 LETTER_LOCKED
 *  - errors                                 -> { error: { code, message, details? } }
 *
 * `data.letter` is null when the edition exists but the admin has not saved a
 * letter yet — the caller then keeps whatever honest fallback it already has.
 */

import type { LetterSection, LetterThumbnail } from "@/components/birthday/LetterScene";
import type { PublicLetter } from "@/lib/birthday/letters/public-view";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PublicLetterData {
  year: number;
  age: number;
  revealed: boolean;
  revealAt: string;
  letter: PublicLetter | null;
}

export type LetterLoadResult =
  | { status: "ok"; data: PublicLetterData }
  | { status: "locked" }
  | { status: "unavailable" };

/** Build the public letter endpoint URL. */
export function letterUrl(year?: number): string {
  return year === undefined ? "/api/birthday/letter" : `/api/birthday/letter?year=${year}`;
}

function isThumbnail(value: unknown): value is LetterThumbnail {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<LetterThumbnail>;
  return typeof t.alt === "string";
}

function isLetter(value: unknown): value is PublicLetter {
  if (!value || typeof value !== "object") return false;
  const l = value as Partial<PublicLetter>;
  return (
    typeof l.title === "string" &&
    typeof l.displayDate === "string" &&
    typeof l.fullText === "string" &&
    Array.isArray(l.sections) &&
    (l.thumbnail === null || isThumbnail(l.thumbnail))
  );
}

function isLetterData(value: unknown): value is PublicLetterData {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<PublicLetterData>;
  return (
    typeof d.year === "number" &&
    typeof d.age === "number" &&
    typeof d.revealed === "boolean" &&
    typeof d.revealAt === "string" &&
    (d.letter === null || isLetter(d.letter))
  );
}

/**
 * Load the birthday letter. NEVER throws and NEVER fabricates content.
 *  - 403         -> `locked` (the birthday has not happened yet).
 *  - 5xx/network -> `unavailable` (never an empty letter).
 */
export async function loadBirthdayLetter(
  fetcher: FetchLike,
  year?: number,
): Promise<LetterLoadResult> {
  let res: Response;
  try {
    res = await fetcher(letterUrl(year), { headers: { accept: "application/json" } });
  } catch {
    return { status: "unavailable" };
  }

  if (res.status === 403) return { status: "locked" };
  if (!res.ok) return { status: "unavailable" };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "unavailable" };
  }

  const data = (body as { data?: unknown } | null)?.data;
  if (!isLetterData(data)) return { status: "unavailable" };
  return { status: "ok", data };
}

/** Map the public payload to the letter sections used by the reader. */
export function toSections(letter: PublicLetter): LetterSection[] {
  return letter.sections;
}
