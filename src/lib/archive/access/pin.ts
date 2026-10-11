import { burnDummyComparison, hashPassword, verifyPassword } from "@/lib/auth/password";

import { ARCHIVE_PIN_PATTERN } from "./policy";

/**
 * PIN hashing & verification for the private-archive visitor gate
 * (Tahap VU-ARCHIVE-ACCESS-3A).
 *
 * Reuses the project's bcrypt helpers (`hashPassword`/`verifyPassword`) so the
 * PIN and the admin password share ONE audited hashing implementation. The PIN
 * is NEVER stored or returned in plaintext; only its bcrypt hash is persisted.
 *
 * The PIN is a SEPARATE credential from the admin password: verifying or
 * changing one never affects the other.
 */

/** True only for a well-formed PIN (digits, bounded length). */
export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && ARCHIVE_PIN_PATTERN.test(pin);
}

/** Hash a plaintext PIN. Refuses a malformed PIN instead of storing junk. */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error("hashPin: PIN tidak memenuhi format yang diizinkan.");
  }
  return hashPassword(pin);
}

/**
 * Verify a plaintext PIN against a stored bcrypt hash.
 *
 * FAIL-CLOSED and timing-neutral:
 *  - a malformed PIN runs a dummy bcrypt comparison, then returns false;
 *  - a missing/empty stored hash runs a dummy bcrypt comparison, then returns
 *    false (an unconfigured PIN is NOT an empty PIN that can pass);
 *  - any compare error returns false rather than throwing.
 */
export async function verifyPin(
  pin: string,
  pinHash: string | null | undefined,
): Promise<boolean> {
  if (!isValidPinFormat(pin)) {
    await burnDummyComparison(typeof pin === "string" ? pin : "");
    return false;
  }
  if (typeof pinHash !== "string" || pinHash.length === 0) {
    await burnDummyComparison(pin);
    return false;
  }
  return verifyPassword(pin, pinHash);
}
