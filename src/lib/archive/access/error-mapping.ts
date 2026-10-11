import {
  ArchiveAccessDisabledError,
  ArchiveAccessIdentityError,
  ArchiveAccessUnavailableError,
} from "./errors";

/**
 * Maps archive-access domain errors to a SAFE HTTP response descriptor
 * (Tahap VU-ARCHIVE-ACCESS-3B/3D).
 *
 * The "schema missing", "access disabled / PIN not set", and "client identity
 * unknown" cases all map to a single generic 503: the client must not learn
 * whether an archive exists, whether a PIN is configured, which dependency is
 * missing, or why the request was refused. Returns null for anything else so the
 * caller keeps its own generic 500 handling.
 */
export interface ArchiveAccessErrorDescriptor {
  status: number;
  code: string;
  message: string;
}

export function describeArchiveAccessError(
  error: unknown,
): ArchiveAccessErrorDescriptor | null {
  if (
    error instanceof ArchiveAccessUnavailableError ||
    error instanceof ArchiveAccessDisabledError ||
    error instanceof ArchiveAccessIdentityError
  ) {
    return {
      status: 503,
      code: "ARCHIVE_ACCESS_UNAVAILABLE",
      message: "Akses arsip belum tersedia.",
    };
  }
  return null;
}
