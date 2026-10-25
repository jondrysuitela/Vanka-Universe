import { jsonError, jsonOk } from "@/lib/auth/guard";
import { isCycleRevealed, cycleWindowForYear } from "@/lib/birthday/cycle";
import { getPublishedMusic } from "@/lib/birthday/music/repository";

/**
 * GET /api/birthday/music?year=2026 — the PUBLIC song of one revealed edition.
 *
 * Mirrors the letter and gallery gates exactly: nothing answers before that
 * edition's own birthday, so a song cannot be previewed early through this
 * route. A PUBLISHED song is required — a candidate row is invisible here.
 *
 * "No song" is a 200 with `music: null`, NOT a 404: a missing song is a normal
 * state (the player falls back to the bundled file), and a 404 would make the
 * player's fallback path look like an error in the console on every visit.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const yearParam = url.searchParams.get("year");

    const year =
      yearParam === null ? null : Number.isInteger(Number(yearParam)) ? Number(yearParam) : NaN;
    const cycle = year === null ? null : cycleWindowForYear(year);

    if (year !== null && cycle === null) {
      return jsonError(422, "INVALID_YEAR", "Tahun edisi tidak valid (harus usia 1–17).");
    }

    const now = new Date();
    if (cycle !== null && !isCycleRevealed(cycle.year, now)) {
      return jsonError(
        403,
        "MUSIC_LOCKED",
        "Musik ulang tahun belum dibuka sampai tanggal ulang tahunnya.",
        { year: cycle.year, revealed: false, revealAt: cycle.revealAt.toISOString() },
      );
    }

    // Without an explicit year we cannot pick "the newest revealed edition"
    // here without duplicating the cycle policy; the player always passes one.
    if (cycle === null) {
      return jsonError(400, "YEAR_REQUIRED", "Sertakan tahun edisi (?year=2026).");
    }

    const music = await getPublishedMusic(cycle.year);
    return jsonOk({
      year: cycle.year,
      age: cycle.age,
      music: music === null ? null : { mediaId: music.mediaId, volume: music.volume },
    });
  } catch {
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
