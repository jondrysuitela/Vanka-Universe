import { ApiError, assertSafeMutation, jsonError, jsonOk, requireSession } from "@/lib/auth/guard";
import { parseMemoryId, updateMemorySchema } from "@/lib/memories/schema";
import { canDeleteMemory, canUpdateMemory } from "@/lib/memories/policy";
import {
  deleteMemory,
  isForeignKeyViolation,
  selectMemoryById,
  updateMemory,
} from "@/lib/memories/repository";
import { requestClientInfo, writeAuditLogBestEffort } from "@/lib/memories/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function resolveId(ctx: RouteContext): Promise<string> {
  const { id } = await ctx.params;
  const valid = parseMemoryId(id);
  if (!valid) throw new ApiError(400, "INVALID_ID", "ID kenangan tidak valid.");
  return valid;
}

function parseBody(request: Request): Promise<unknown> {
  return request.json();
}

/**
 * GET /api/memories/[id]
 * Detail satu kenangan. Baris yang tidak terlihat aktor -> 404 (hidden),
 * bukan 403, agar keberadaan data tidak bocor.
 */
export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    const id = await resolveId(ctx);
    const row = await selectMemoryById(admin, id);
    if (!row) return jsonError(404, "NOT_FOUND", "Kenangan tidak ditemukan.");
    return jsonOk(row);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/**
 * PATCH /api/memories/[id]
 * Perbarui kenangan. Hanya field whitelist yang bisa diubah; id/created_by/
 * created_at/owner_id/updated_at ditolak langsung oleh strictObject (422).
 * updated_at selalu ditetapkan server-side.
 */
export async function PATCH(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    const id = await resolveId(ctx);

    const existing = await selectMemoryById(admin, id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Kenangan tidak ditemukan.");
    if (!canUpdateMemory(admin, existing)) {
      throw new ApiError(403, "FORBIDDEN", "Hak akses tidak mencukupi.");
    }

    let body: unknown;
    try {
      body = await parseBody(request);
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = updateMemorySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const updated = await updateMemory({ viewer: admin, id, patch: parsed.data });
    if (!updated) return jsonError(404, "NOT_FOUND", "Kenangan tidak ditemukan.");

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(parsed.data)) {
      diff[key] = {
        from: (existing as unknown as Record<string, unknown>)[key],
        to: (parsed.data as unknown as Record<string, unknown>)[key],
      };
    }

    const { ipAddress, userAgent } = requestClientInfo(request);
    await writeAuditLogBestEffort({
      actorId: admin.id,
      actorEmail: admin.email,
      actorLabel: admin.name,
      action: "update",
      entityId: id,
      ipAddress,
      userAgent,
      diff,
    });

    return jsonOk(updated);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/**
 * DELETE /api/memories/[id]
 * Hapus kenangan. Hanya owner/admin. Media TIDAK pernah dihapus otomatis:
 * kunci FK RESTRICT di media akan memunculkan pelanggaran FK -> 409.
 */
export async function DELETE(request: Request, ctx: RouteContext): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    const id = await resolveId(ctx);
    if (!canDeleteMemory(admin)) {
      throw new ApiError(403, "FORBIDDEN", "Hak akses tidak mencukupi.");
    }

    const existing = await selectMemoryById(admin, id);
    if (!existing) return jsonError(404, "NOT_FOUND", "Kenangan tidak ditemukan.");

    try {
      await deleteMemory(id);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        return jsonError(409, "CONFLICT", "Kenangan masih memiliki media terkait. Hapus media terlebih dahulu.");
      }
      throw error;
    }

    const { ipAddress, userAgent } = requestClientInfo(request);
    await writeAuditLogBestEffort({
      actorId: admin.id,
      actorEmail: admin.email,
      actorLabel: admin.name,
      action: "delete",
      entityId: id,
      ipAddress,
      userAgent,
      diff: { deleted: existing },
    });

    return jsonOk({ id });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}