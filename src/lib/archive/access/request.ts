/**
 * Client-identity resolution for the private-archive visitor gate
 * (Tahap VU-ARCHIVE-ACCESS-3D).
 *
 * LIMITATIONS (documented, not hidden):
 *  - A Next.js Route Handler receives only `Request`; the raw TCP socket peer
 *    address is NOT exposed, so there is no intrinsically trustworthy client IP.
 *  - Forwarding headers (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, …)
 *    are CLIENT-CONTROLLABLE unless a trusted proxy strips/overwrites them. Using
 *    any of them without a proved proxy configuration lets a client forge its
 *    identity and defeat IP-based rate limiting.
 *
 * POLICY: this module trusts a forwarding header ONLY when the deployment
 * explicitly names it via `ARCHIVE_TRUSTED_PROXY_HEADER`. That env var is an
 * operator assertion that "the proxy in front of this app sets this header".
 * With no such configuration, the client IP is UNKNOWN (null) and the archive
 * gate fails closed (see `access/route.ts`) rather than sharing a single global
 * bucket. No platform header is assumed trusted by default.
 */

/** Env var naming the ONE header a trusted proxy is known to set. */
export const TRUSTED_IP_HEADER_ENV = "ARCHIVE_TRUSTED_PROXY_HEADER";

/** The configured trusted header name (lowercased), or null when unconfigured. */
export function trustedIpHeader(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const name = env[TRUSTED_IP_HEADER_ENV];
  if (typeof name !== "string") return null;
  const trimmed = name.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

/**
 * Resolve the client IP for rate limiting, or null when it cannot be trusted.
 *
 * Returns a value ONLY when a trusted header is explicitly configured AND
 * present. `x-forwarded-for` is read ONLY if it is itself the configured header;
 * it is never consulted by default. The first hop of a comma list is used.
 */
export function resolveClientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const header = trustedIpHeader(env);
  if (!header) return null;
  const raw = request.headers.get(header);
  if (!raw) return null;
  const value = raw.split(",")[0].trim();
  return value.length ? value : null;
}
