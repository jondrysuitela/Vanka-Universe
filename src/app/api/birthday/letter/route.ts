import { jsonError, jsonOk } from "@/lib/auth/guard";
import {
  FIRST_CYCLE_YEAR,
  cycleWindowForYear,
  isCycleRevealed,
  latestRevealedCycle,
} from "@/lib/birthday/cycle";
import { toPublicLetter } from "@/lib/birthday/letters/public-view";
import { selectLetterByYear } from "@/lib/birthday/letters/repository";
import { isUndefinedTableError } from "@/lib/media/db/errors";

/**
 * GET /api/birthday/letter — the PUBLIC letter of ONE already-revealed cycle.
 *
 * This is the public counterpart of the session-gated `GET /api/birthday/letters`
 * (admin list). It serves exactly the same content the admin saved, but only
 * after that cycle's birthday: before then it answers `403 LETTER_LOCKED` with
 * the reveal instant and NEVER the letter. The opening thumbnail's `src` is
 * rewritten to the date-gated media route (see `public-view.ts`), so the private
 * admin path is never leaked.
 *
 * Query:
 *  - `year` (optional): cycle year. Default: the MOST RECENT revealed cycle.
 *
 * Read-only: never creates an edition, never writes, never publishes.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const now = new Date();

    const yearParam = url.searchParams.get("year");
    let cycle: ReturnType<typeof cycleWindowForYear>;
    if (yearParam !== null) {
      const parsed = Number(yearParam);
      cycle = Number.isInteger(parsed) ? cycleWindowForYear(parsed) : null;
      if (cycle === null) {
        return jsonError(422, "INVALID_YEAR", "Tahun edisi tidak valid (harus usia 1–17).");
      }
    } else {
      cycle = latestRevealedCycle(now);
      if (cycle === null) {
        return jsonError(
          403,
          "LETTER_LOCKED",
          "Surat ulang tahun belum dibuka sampai tanggal ulang tahunnya.",
          {
            revealed: false,
            revealAt: cycleWindowForYear(FIRST_CYCLE_YEAR)?.revealAt.toISOString() ?? null,
          },
        );
      }
    }

    if (!isCycleRevealed(cycle.year, now)) {
      return jsonError(
        403,
        "LETTER_LOCKED",
        "Surat ulang tahun belum dibuka sampai tanggal ulang tahunnya.",
        {
          year: cycle.year,
          age: cycle.age,
          revealed: false,
          revealAt: cycle.revealAt.toISOString(),
        },
      );
    }

    const row = await selectLetterByYear(cycle.year);
    return jsonOk({
      year: cycle.year,
      age: cycle.age,
      revealed: true,
      revealAt: cycle.revealAt.toISOString(),
      letter: row ? toPublicLetter(row) : null,
    });
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return jsonError(
        503,
        "LETTER_NOT_MIGRATED",
        "Surat ulang tahun belum tersedia di database (migrasi 4g26 belum dijalankan).",
      );
    }
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
