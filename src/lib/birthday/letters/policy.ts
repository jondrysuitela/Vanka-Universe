import type { SessionAdmin } from "@/lib/auth/session";

/**
 * Authorization for the birthday-letters API (Tahap 4G.30).
 *
 * Birthday letters are Ayah's personal content that feeds the public birthday
 * experience. Writing and reading them is restricted to media/content operators
 * (`owner`, `admin`) — the same class trusted with private media. `editor` and
 * any unknown role are DENIED (403). The role always comes from the
 * server-validated session (`requireSession`), never from the request.
 */
export const BIRTHDAY_LETTER_ROLES: readonly SessionAdmin["role"][] = ["owner", "admin"];

export function canManageBirthdayLetters(admin: SessionAdmin): boolean {
  return BIRTHDAY_LETTER_ROLES.includes(admin.role);
}
