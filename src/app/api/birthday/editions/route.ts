import { ApiError, assertSafeMutation, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { getThemeByAge } from "@/lib/birthday/theme-registry";
import { letterEditionIdentity } from "@/lib/birthday/persistence";
import { BIRTHDAY_EDITION_ROLES } from "@/lib/birthday/editions/policy";
import { createBirthdayEditionSchema } from "@/lib/birthday/editions/schema";
import { createDraftEdition } from "@/lib/birthday/editions/repository";

/**
 * POST /api/birthday/editions — create a DRAFT birthday edition for one age.
 *
 * Requires a valid admin session AND an operator role (owner/admin). The client
 * sends only `age`; year/title/subtitle are derived server-side from the static
 * theme registry, and status/privacy/created_by are fixed. A duplicate year is
 * refused (409), never overwritten. This endpoint never publishes.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, BIRTHDAY_EDITION_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = createBirthdayEditionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const identity = letterEditionIdentity(parsed.data.age);
    const theme = getThemeByAge(parsed.data.age);
    if (!identity || !theme) {
      return jsonError(422, "INVALID_AGE", "Usia edisi di luar katalog.");
    }

    const row = await createDraftEdition(admin, {
      year: identity.year,
      title: theme.title,
      subtitle: theme.subtitle,
    });

    if (!row) {
      // ON CONFLICT (year) DO NOTHING inserted nothing → the edition already exists.
      return jsonError(
        409,
        "EDITION_EXISTS",
        `Edisi ulang tahun ${identity.year} sudah ada dan tidak ditimpa.`,
      );
    }

    return jsonOk(row, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
