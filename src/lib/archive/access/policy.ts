/**
 * Access policy constants for the private-archive VISITOR gate
 * (Tahap VU-ARCHIVE-ACCESS-3A).
 *
 * These values describe the SEPARATE visitor access channel (PIN + visitor
 * session). They are deliberately NOT shared with the admin session/policy:
 * a visitor session must never satisfy an admin guard or role.
 *
 * Nothing here reads secrets. No PIN value is ever defined in source.
 */

/** Cookie name for the visitor access session. Distinct from `vanka_session`. */
export const ARCHIVE_ACCESS_COOKIE_NAME = "vanka_archive_access";

/**
 * Absolute visitor session lifetime (hours). No sliding renewal: a visitor
 * session is valid for at most this long, then must re-enter the PIN.
 */
export const ARCHIVE_ACCESS_TTL_HOURS = 12;

/** PIN is a string of digits; length is bounded to keep it brute-forceable-but-finite. */
export const ARCHIVE_PIN_MIN_LENGTH = 4;
export const ARCHIVE_PIN_MAX_LENGTH = 12;

/** Digits only, bounded length. Built from the constants above to avoid drift. */
export const ARCHIVE_PIN_PATTERN = new RegExp(
  `^\\d{${ARCHIVE_PIN_MIN_LENGTH},${ARCHIVE_PIN_MAX_LENGTH}}$`,
);

/** Sliding window for the PIN rate limiter. */
export const ARCHIVE_ACCESS_WINDOW_MINUTES = 15;

/**
 * Per-IP failure threshold. Generous enough for genuine typos, small enough
 * to throttle a single source.
 */
export const ARCHIVE_MAX_FAILURES_PER_IP = 10;

/**
 * Global failure brake in the same window. Chosen FAR above the per-IP
 * threshold so a SINGLE IP can never reach it (one IP is capped by the per-IP
 * threshold first). It can only be tripped by many distinct sources, i.e. a
 * distributed attempt.
 *
 * TRADE-OFF (documented, not hidden): when tripped, the brake denies access to
 * EVERYONE (including the legitimate visitor) for the rest of the window. This
 * is an intentional fail-closed posture — a sustained distributed attack
 * degrades availability rather than letting unbounded guessing proceed. It
 * cannot be triggered by one IP, so a lone attacker cannot lock the archive.
 */
export const ARCHIVE_MAX_FAILURES_GLOBAL = 100;
