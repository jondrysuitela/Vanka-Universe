import { ApiError, jsonError, jsonOk, requireSession } from "@/lib/auth/guard";

// Node.js runtime is the Next.js 16 default; `runtime` segment config is
// intentionally omitted (incompatible with `cacheComponents`).

export async function GET(request: Request): Promise<Response> {
  try {
    const { admin } = await requireSession(request);
    return jsonOk({ admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}