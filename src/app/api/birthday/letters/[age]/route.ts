import { ApiError, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { letterEditionIdentity } from "@/lib/birthday/persistence";
import { BIRTHDAY_LETTER_ROLES } from "@/lib/birthday/letters/policy";
import { parseLetterAge } from "@/lib/birthday/letters/schema";
import { selectLetterByYear } from "@/lib/birthday/letters/repository";

interface RouteContext {
  params: Promise<{ age: string }>;
}

/**
 * GET /api/birthday/letters/[age] — one letter by edition age (1–17).
 * Requires a valid admin session AND an operator role.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_LETTER_ROLES);

    const { age } = await ctx.params;
    const parsedAge = parseLetterAge(age);
    const identity = parsedAge === null ? null : letterEditionIdentity(parsedAge);
    if (!identity) {
      throw new ApiError(400, "INVALID_AGE", "Usia edisi tidak valid.");
    }

    const row = await selectLetterByYear(identity.year);
    if (!row) return jsonError(404, "NOT_FOUND", "Surat tidak ditemukan.");
    return jsonOk(row);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
