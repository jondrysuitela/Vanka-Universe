import { ApiError, assertSafeMutation, jsonError, jsonOk, requireRole, requireSession } from "@/lib/auth/guard";
import { PRIVATE_ARCHIVE_ROLES } from "@/lib/archive/policy";
import { validatePrivateAudioReference } from "@/lib/archive/media-link";
import { upsertArchiveSchema } from "@/lib/archive/schema";
import { selectArchive, upsertArchive } from "@/lib/archive/repository";

/**
 * GET /api/archive  — the singleton private archive (or null).
 * PUT /api/archive  — create/update the private-archive draft.
 *
 * Both require a valid admin session AND an operator role (owner/admin). The
 * archive is private: it is never served from a public route and has no
 * client-supplied privacy flag. `musicSrc` (a path/URL) is rejected by the input
 * schema; a non-null `musicMediaId` is rejected fail-closed today (see
 * `media-link.ts`).
 */

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    requireRole(admin, PRIVATE_ARCHIVE_ROLES);
    const row = await selectArchive();
    return jsonOk(row);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    requireRole(admin, PRIVATE_ARCHIVE_ROLES);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = upsertArchiveSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    // FAIL-CLOSED: no audio path can be proven today, so a non-null reference is
    // refused rather than stored blindly.
    const audio = validatePrivateAudioReference(parsed.data.musicMediaId);
    if (!audio.ok) {
      return jsonError(422, "AUDIO_NOT_SUPPORTED", audio.reason ?? "Audio privat belum didukung.");
    }

    const row = await upsertArchive(admin, parsed.data);
    return jsonOk(row);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}
