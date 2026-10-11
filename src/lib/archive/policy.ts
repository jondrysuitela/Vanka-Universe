import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Authorization for the private-archive API (Tahap 4G.30).
 *
 * The archive is always private; it has NO per-row privacy flag and NO public
 * route. Read and write are restricted to operators (`owner`, `admin`). The role
 * always comes from the server-validated session, never from the request.
 */
export const PRIVATE_ARCHIVE_ROLES: readonly SessionAdmin["role"][] = ["owner", "admin"];

export function canManageArchive(admin: SessionAdmin): boolean {
  return PRIVATE_ARCHIVE_ROLES.includes(admin.role);
}
