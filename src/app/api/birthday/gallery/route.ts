import {
  ApiError,
  jsonError,
  jsonOk,
  requireRole,
  requireSession,
} from "@/lib/auth/guard";
import { BIRTHDAY_EDITION_ROLES } from "@/lib/birthday/editions/policy";
import {
  cycleForDate,
  cycleWindowForYear,
  isCycleRevealed,
  latestRevealedCycle,
  FIRST_CYCLE_YEAR,
} from "@/lib/birthday/cycle";
import {
  BirthdayGalleryUnavailableError,
  listCycleGallery,
} from "@/lib/birthday/gallery/repository";

/**
 * GET /api/birthday/gallery — the photo/video gallery of ONE birthday cycle.
 *
 * A cycle bundles every READY media uploaded before 27 October of its year (see
 * `cycle.ts`); nothing is attached by hand. This endpoint is PUBLIC, but it stays
 * LOCKED until the cycle's own birthday: before then it answers `403
 * GALLERY_LOCKED` with the reveal instant, never the items.
 *
 * Query:
 *  - `year` (optional): cycle year. Public default: the MOST RECENT revealed
 *    cycle (the birthday already celebrated). Preview default: the cycle being
 *    prepared right now.
 *  - `preview=1` (optional): admin preview. Requires a valid session AND an
 *    operator role (`owner`/`admin`) and bypasses the reveal gate. The default
 *    (absent) is the public, gated path — a session cookie alone never unlocks
 *    the public response.
 *
 * This endpoint never mutates anything and never publishes.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const preview = url.searchParams.get("preview") === "1";

    if (preview) {
      // Admin preview: explicit, session-gated bypass of the date gate.
      const { admin } = await requireSession(request);
      requireRole(admin, BIRTHDAY_EDITION_ROLES);
    }

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
      // Public: the most recent birthday already celebrated. Preview: the cycle
      // being prepared right now (what newly uploaded media will join).
      cycle = preview ? cycleForDate(now) : latestRevealedCycle(now);
      if (cycle === null) {
        if (preview) {
          return jsonError(404, "NO_ACTIVE_CYCLE", "Tidak ada siklus ulang tahun yang siap saat ini.");
        }
        return jsonError(
          403,
          "GALLERY_LOCKED",
          "Galeri ulang tahun belum dibuka sampai tanggal ulang tahunnya.",
          {
            revealed: false,
            revealAt: cycleWindowForYear(FIRST_CYCLE_YEAR)?.revealAt.toISOString() ?? null,
          },
        );
      }
    }

    const revealed = isCycleRevealed(cycle.year, now);
    if (!revealed && !preview) {
      return jsonError(
        403,
        "GALLERY_LOCKED",
        "Galeri ulang tahun belum dibuka sampai tanggal ulang tahunnya.",
        {
          year: cycle.year,
          age: cycle.age,
          revealed: false,
          revealAt: cycle.revealAt.toISOString(),
        },
      );
    }

    const items = await listCycleGallery(cycle);
    return jsonOk({
      year: cycle.year,
      age: cycle.age,
      revealed,
      revealAt: cycle.revealAt.toISOString(),
      items,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof BirthdayGalleryUnavailableError) {
      return jsonError(503, "GALLERY_NOT_MIGRATED", error.message);
    }
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
