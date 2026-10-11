import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getSessionAdmin, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export const ADMIN_LOGIN_PATH = "/admin/login";

// Cache Components is enabled (next.config.ts `cacheComponents: true`). This
// layout performs a per-request auth check backed by an uncached database
// query, and there is no meaningful static shell to prerender for `/admin/*`
// (auth gating happens high in the tree). Opt this segment out of
// instant-navigation validation so it renders per request as a blocking route.
export const instant = false;

/**
 * Server-side guard for every protected `/admin/*` page.
 *
 * ROUTE-GROUP PATTERN: this layout lives in the `(protected)` route group, so
 * it wraps the whole dashboard (dashboard, themes, settings, memories, media,
 * content, birthday, archive) while `/admin/login` — which is OUTSIDE the
 * group — stays reachable without a session. The `(protected)` segment does
 * not appear in any URL.
 *
 * Enforced on the SERVER (React Server Component): no client-side check, no
 * hidden-UI trick. An unverified visitor is redirected to the login page
 * before any protected markup is produced.
 *
 * Fail-closed: a database/session-verification error is treated exactly like
 * "no session" (redirect to login) and is never reported as authenticated.
 * The error is logged for operators only (`audit.ts` uses the same convention)
 * and is never shown to the client.
 */
export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  // Force request-time rendering BEFORE any database-backed work. Without this,
  // Cache Components would attempt the session query during static prerendering
  // and fail with "encountered uncached data during prerendering"
  // (src/lib/auth/session.ts -> getPool().query()). `connection()` stalls the
  // prerender so the uncached session lookup only ever runs on a real request.
  await connection();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

  let authenticated = false;
  try {
    authenticated = Boolean(await getSessionAdmin(token));
  } catch (error) {
    console.error(
      "[admin-guard] session verification failed:",
      error instanceof Error ? error.message : error,
    );
    authenticated = false;
  }

  if (!authenticated) redirect(ADMIN_LOGIN_PATH);

  return <>{children}</>;
}
