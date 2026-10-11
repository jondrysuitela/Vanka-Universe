import { ApiError, assertSafeMutation, jsonError, jsonOk, requireSession } from "@/lib/auth/guard";
import { clearSessionCookie, revokeSession } from "@/lib/auth/session";

// Node.js runtime is the Next.js 16 default; `runtime` segment config is
// intentionally omitted (incompatible with `cacheComponents`).

export async function POST(request: Request): Promise<Response> {
  try {
    assertSafeMutation(request);
    const { token } = await requireSession(request);
    await revokeSession(token);
    const response = jsonOk({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    return jsonError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
  }
}