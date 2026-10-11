import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Authorization for birthday-edition creation (Tahap 4G.31).
 *
 * Creating an edition is an operator action (`owner`, `admin`); `editor` and any
 * unknown role are DENIED. The role comes from the server-validated session,
 * never from the request.
 */
export const BIRTHDAY_EDITION_ROLES: readonly SessionAdmin["role"][] = ["owner", "admin"];

export function canManageBirthdayEditions(admin: SessionAdmin): boolean {
  return BIRTHDAY_EDITION_ROLES.includes(admin.role);
}
