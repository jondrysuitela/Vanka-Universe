import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Media access policy (Tahap 4G.20) — approved by the project owner.
 *
 * Decision:
 *  - `owner` / `admin` (operator): may VIEW, UPLOAD, EDIT metadata, and DELETE
 *    media — still subject to the CSRF checks and the fail-closed media
 *    reference check on DELETE.
 *  - `editor`: may NOT upload, edit, or delete media by default.
 *  - Reading: `GET` is granted ONLY to roles explicitly authorized by this
 *    decision. Media is private (served solely through the authenticated
 *    `/api/media/[id]` route, never statically from `public/`), and an editor
 *    has no explicit read grant — so an editor is DENIED read as well and
 *    receives 403, never a silent list/stream of private files.
 *  - Any other/unknown role is denied.
 *
 * The role always comes from the server-validated session (`getSessionAdmin`),
 * never from the request body, query string, headers, or stored metadata.
 *
 * This mirrors the shape of `src/lib/memories/policy.ts` but is deliberately a
 * SEPARATE policy: the Memories policy is not modified by this stage.
 */

type Role = SessionAdmin["role"];

/** Roles authorized for media operations (view incl.). */
export const MEDIA_OPERATOR_ROLES: readonly Role[] = ["owner", "admin"];

/** True only for the explicitly authorized media roles. */
export function isMediaOperator(admin: SessionAdmin): boolean {
  return MEDIA_OPERATOR_ROLES.includes(admin.role);
}
