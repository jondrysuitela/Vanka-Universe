import { compare, hash } from "bcryptjs";

/**
 * bcrypt cost factor. Configurable via env for tests; production default 12.
 * The value is read once at module load.
 */
export const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

/** Hash a plaintext password. Never store or return the plaintext. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 * Returns false (instead of throwing) for NULL/empty hash or empty input,
 * so a missing credential never becomes an error path that leaks details.
 */
export async function verifyPassword(
  plain: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!plain) return false;
  if (typeof passwordHash !== "string" || passwordHash.length === 0) return false;
  try {
    return await compare(plain, passwordHash);
  } catch {
    return false;
  }
}

let dummyHash: string | null = null;

/**
 * Run a bcrypt comparison even when the account does not exist, so response
 * timing does not reveal whether an email is registered. Always call this in
 * the login path when the user is unknown or has no hash.
 */
export async function burnDummyComparison(plain: string): Promise<void> {
  if (!plain) return;
  if (!dummyHash) {
    dummyHash = await hashPassword("vanka-dummy-credential-never-a-real-password");
  }
  await verifyPassword(plain, dummyHash);
}