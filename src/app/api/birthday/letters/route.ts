import { ApiError, assertSafeMutation, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { cycleWindowForYear, isCycleRevealed } from "@/lib/birthday/cycle";
import { letterEditionIdentity } from "@/lib/birthday/persistence";
import { BIRTHDAY_LETTER_ROLES } from "@/lib/birthday/letters/policy";
import { upsertBirthdayLetterSchema } from "@/lib/birthday/letters/schema";
import {
  selectEditionIdByYear,
  selectLetters,
  upsertDraftLetter,
} from "@/lib/birthday/letters/repository";

/**
 * GET /api/birthday/letters — list letters with their edition year.
 * POST /api/birthday/letters — create or update a DRAFT letter for one edition.
 *
 * Both require a valid admin session AND an operator role (owner/admin).
 * Writes are draft-only: `status` is hardcoded server-side and the input schema
 * rejects any client-supplied status/authorship/timestamp keys.
 *
 * FREEZE: an edition whose birthday has passed is PUBLISHED by date — its letter
 * is immutable. The write is refused with `409 LETTER_PUBLISHED` so the publicly
 * served version can never drift after it goes live. (The public read
 * `GET /api/birthday/letter` exposes the letter from the reveal instant on.)
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_LETTER_ROLES);
    const rows = await selectLetters();
    return jsonOk(rows);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_LETTER_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = upsertBirthdayLetterSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    // Identity is derived SERVER-SIDE from the static registry — never from body.
    const identity = letterEditionIdentity(parsed.data.age);
    if (!identity) {
      return jsonError(422, "INVALID_AGE", "Usia edisi di luar katalog.");
    }

    // Published-by-date: once the birthday has passed the letter is FROZEN, so
    // the public version served after the reveal can never change underfoot.
    if (isCycleRevealed(identity.year, new Date())) {
      return jsonError(
        409,
        "LETTER_PUBLISHED",
        `Surat edisi ${identity.year} sudah tayang dan dibekukan; tidak dapat diubah lagi.`,
        {
          year: identity.year,
          age: identity.age,
          revealAt: cycleWindowForYear(identity.year)?.revealAt.toISOString() ?? null,
        },
      );
    }

    const editionId = await selectEditionIdByYear(identity.year);
    if (!editionId) {
      // No edition → no letter. This route never creates an edition.
      return jsonError(
        409,
        "EDITION_NOT_FOUND",
        `Edisi ulang tahun ${identity.year} belum ada; surat tidak dibuat.`,
      );
    }

    const result = await upsertDraftLetter(admin, editionId, parsed.data);
    if (result.outcome === "locked") {
      return jsonError(
        409,
        "LETTER_LOCKED",
        "Surat edisi ini sudah tidak berstatus draf dan tidak dapat ditimpa.",
      );
    }
    return jsonOk(result.row);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
