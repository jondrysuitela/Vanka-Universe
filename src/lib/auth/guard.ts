import { NextResponse } from "next/server";

import { getSessionAdmin, readSessionToken, type SessionAdmin } from "@/lib/auth/session";

/** Uniform API error for route handlers. Never carries stack/db details to clients. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toResponse(): NextResponse {
    return jsonError(this.status, this.code, this.message, this.details);
  }
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

export function jsonOk(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const API_CUSTOM_HEADER = "x-vanka-request";

/**
 * CSRF / origin protection for mutating API endpoints (login, logout, and all
 * future writes). SameSite=Lax alone is NOT treated as sufficient.
 *
 * Requires, for POST/PUT/PATCH/DELETE:
 *  - Origin header present and equal to the trusted app origin
 *    (APP_ORIGIN env, or the request's own origin otherwise);
 *  - Content-Type application/json;
 *  - custom header `x-vanka-request: 1` (proves a fetch-style request, which
 *    simple cross-site HTML forms cannot send).
 */
export function assertSafeMutation(request: Request): void {
  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.has(method)) return;

  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expectedOrigin = process.env.APP_ORIGIN ?? url.origin;
  if (!origin || origin !== expectedOrigin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "Origin tidak diizinkan.");
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new ApiError(403, "CONTENT_TYPE_REJECTED", "Content-Type harus application/json.");
  }

  if ((request.headers.get(API_CUSTOM_HEADER) ?? "").trim() !== "1") {
    throw new ApiError(403, "CSRF_HEADER_REJECTED", `Header ${API_CUSTOM_HEADER} wajib disertakan.`);
  }
}

export interface AuthedRequest {
  admin: SessionAdmin;
  token: string;
}

/** Validate the session from cookies; 401 when missing/revoked/expired/inactive. */
export async function requireSession(request: Request): Promise<AuthedRequest> {
  const token = readSessionToken(request);
  if (!token) throw new ApiError(401, "UNAUTHORIZED", "Sesi tidak valid atau telah berakhir.");
  const admin = await getSessionAdmin(token);
  if (!admin) throw new ApiError(401, "UNAUTHORIZED", "Sesi tidak valid atau telah berakhir.");
  return { admin, token };
}

/** Require one of the given roles; 403 otherwise. */
export function requireRole(
  admin: SessionAdmin,
  roles: readonly SessionAdmin["role"][],
): void {
  if (!roles.includes(admin.role)) {
    throw new ApiError(403, "FORBIDDEN", "Hak akses tidak mencukupi.");
  }
}