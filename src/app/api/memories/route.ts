import { NextResponse } from "next/server";

// Node.js runtime is the Next.js 16 default; `runtime` segment config is
// intentionally omitted (incompatible with `cacheComponents`).

import { ApiError, assertSafeMutation, jsonError, jsonOk, requireSession } from "@/lib/auth/guard";
import { createMemorySchema, listMemoriesQuerySchema } from "@/lib/memories/schema";
import { canCreateMemory } from "@/lib/memories/policy";
import { insertMemory, selectMemories } from "@/lib/memories/repository";
import { requestClientInfo, writeAuditLogBestEffort } from "@/lib/memories/audit";

/**
 * GET /api/memories
 * Daftar kenangan dengan pagination + filter + sort whitelist.
 * BUTUH SESSION ADMIN. Visibilitas privacy DIKUATKAN di query (bukan UI).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);

    const url = new URL(request.url);
    const parsed = listMemoriesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Parameter query tidak valid.", parsed.error.flatten());
    }

    const { rows, total } = await selectMemories({ viewer: admin, query: parsed.data });
    const { page, limit } = parsed.data;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return NextResponse.json({ data: rows, meta: { page, limit, total, totalPages } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}

/**
 * POST /api/memories
 * Buat kenangan. created_by/owner_id DIAMBIL DARI SESSION, bukan dari body.
 * Body dengan kunci terlarang (id, created_by, dst.) ditolak 422.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { admin } = await requireSession(request);
    if (!canCreateMemory(admin)) {
      throw new ApiError(403, "FORBIDDEN", "Hak akses tidak mencukupi.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "INVALID_JSON", "Body permintaan bukan JSON valid.");
    }

    const parsed = createMemorySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", parsed.error.flatten());
    }

    const created = await insertMemory(admin, parsed.data);
    const { ipAddress, userAgent } = requestClientInfo(request);
    await writeAuditLogBestEffort({
      actorId: admin.id,
      actorEmail: admin.email,
      actorLabel: admin.name,
      action: "create",
      entityId: created.id,
      ipAddress,
      userAgent,
      diff: parsed.data,
    });

    return jsonOk(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}