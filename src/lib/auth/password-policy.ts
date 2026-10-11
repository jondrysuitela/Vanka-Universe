/**
 * Server-authoritative password policy for admin credentials (Tahap
 * VU-ARCHIVE-ACCESS-4C).
 *
 * PURE: no bcrypt, no database, no env. Reused by the password-change endpoint
 * and by the admin UI so both agree on the rules. The server always re-validates;
 * the browser copy is only for immediate feedback.
 *
 * The admin password is a SEPARATE credential from the private-archive visitor
 * PIN — nothing here touches PINs.
 */

export const MIN_ADMIN_PASSWORD_LENGTH = 8;
export const MAX_ADMIN_PASSWORD_LENGTH = 200;

export type PasswordChangeErrorCode =
  | "CURRENT_REQUIRED"
  | "NEW_TOO_SHORT"
  | "NEW_TOO_LONG"
  | "CONFIRM_MISMATCH"
  | "SAME_AS_CURRENT";

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/**
 * Validate a self-service password change request. Returns an error code, or
 * null when the request is acceptable. Never compares against the stored hash
 * (that is the endpoint's re-authentication step).
 */
export function validatePasswordChange(
  input: PasswordChangeInput,
): PasswordChangeErrorCode | null {
  if (input.currentPassword.length === 0) return "CURRENT_REQUIRED";
  if (input.newPassword.length < MIN_ADMIN_PASSWORD_LENGTH) return "NEW_TOO_SHORT";
  if (input.newPassword.length > MAX_ADMIN_PASSWORD_LENGTH) return "NEW_TOO_LONG";
  if (input.newPassword !== input.confirmPassword) return "CONFIRM_MISMATCH";
  if (input.newPassword === input.currentPassword) return "SAME_AS_CURRENT";
  return null;
}

/** Human-readable, non-sensitive message for a validation error code. */
export function passwordChangeMessage(code: PasswordChangeErrorCode): string {
  switch (code) {
    case "CURRENT_REQUIRED":
      return "Masukkan kata sandi saat ini.";
    case "NEW_TOO_SHORT":
      return `Kata sandi baru minimal ${MIN_ADMIN_PASSWORD_LENGTH} karakter.`;
    case "NEW_TOO_LONG":
      return `Kata sandi baru maksimal ${MAX_ADMIN_PASSWORD_LENGTH} karakter.`;
    case "CONFIRM_MISMATCH":
      return "Konfirmasi kata sandi baru tidak cocok.";
    case "SAME_AS_CURRENT":
      return "Kata sandi baru harus berbeda dari kata sandi saat ini.";
  }
}
