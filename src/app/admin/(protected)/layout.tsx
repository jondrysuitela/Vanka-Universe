import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getSessionAdmin, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export const ADMIN_LOGIN_PATH = "/admin/login";

// NOTE: `export const instant = false;` was REMOVED here on purpose. `instant`
// is a Cache Components segment config and Cache Components is disabled in
// next.config.ts (`cacheComponents: false`) to avoid the workerd staged-render
// hang (cloudflare/workerd#7687, upstream fix in unreleased PR #1318). The
// per-request behaviour is unchanged: this layout reads cookies and performs an
// uncached session query, so it still renders on every request.

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
  // Force request-time rendering BEFORE any database-backed work. This keeps the
  // uncached session query (src/lib/auth/session.ts -> getPool().query()) off any
  // prerender path; without it the lookup could be attempted while the route is
  // being statically prepared. `connection()` is valid with Cache Components off
  // (as configured here) and has no effect on the auth result.
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
