import type { MediaObjectClient } from "@/lib/media/storage/object-client";
import {
  deleteMediaObjectRow,
  listMediaObjectsByStatus,
  markMediaObjectReady,
  type MediaQueryable,
} from "@/lib/media/db/repository";

/**
 * Reconciliation PLAN for `pending` media rows (Tahap 4G.40D-3D0).
 *
 * A `pending` row means "metadata written, object upload not confirmed". It is
 * never user-visible. It can be left behind by a crash between the INSERT and
 * the object PUT, or between the PUT and the `ready` flip.
 *
 * Two DISTINCT cases are handled differently:
 *   - object ABSENT  -> the row is dead metadata with no bytes. Deleting the row
 *     is safe and loses nothing. We only do it after an `exists()` probe says the
 *     object is really missing — never on a guess.
 *   - object PRESENT -> the bytes exist but the upload never finished. The safe
 *     recovery is to promote the row to `ready` (do NOT delete the object).
 *
 * SAFETY PROPERTIES:
 *   - This module NEVER deletes an object. Only metadata rows are removed, and
 *     only when absence was verified.
 *   - It is opt-in and DRY-RUN BY DEFAULT (`dryRun: true`). Nothing runs
 *     automatically; there is no scheduler and no wiring in the request path.
 *   - Age bound (`maxAgeMs`): rows newer than the bound are skipped, so an
 *     in-flight upload is never raced.
 *   - Idempotent: `markMediaObjectReady` and `deleteMediaObjectRow` are keyed by
 *     id; a second run over the same id is a no-op / returns null.
 *   - Never logs object keys; findings carry only the media id and a reason.
 */

/** Default age bound: only reconcile `pending` rows older than 24 hours. */
export const DEFAULT_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Default cap on rows examined per run. */
export const DEFAULT_PENDING_RECONCILE_LIMIT = 500;

export type PendingReconcileAction = "mark-ready" | "delete-row" | "skip";

export interface PendingReconcileFinding {
  id: string;
  action: PendingReconcileAction;
  reason: string;
}

export interface PendingReconcileReport {
  dryRun: boolean;
  scanned: number;
  markedReady: number;
  deletedRows: number;
  skipped: number;
  findings: PendingReconcileFinding[];
}

export interface ReconcilePendingOptions {
  pool: MediaQueryable;
  objects: MediaObjectClient;
  /** Age bound in ms. Defaults to {@link DEFAULT_PENDING_MAX_AGE_MS}. */
  maxAgeMs?: number;
  /** Injectable clock (tests). Defaults to `Date.now()`. */
  now?: number;
  /** Defaults to true. Nothing is written unless explicitly set to false. */
  dryRun?: boolean;
  /** Max rows examined per run. Defaults to {@link DEFAULT_PENDING_RECONCILE_LIMIT}. */
  limit?: number;
}

/**
 * Examine `pending` rows and either report (dry-run) or apply the safe action.
 * Returns a report; never throws for a single-row apply failure (recorded as a
 * `skip` so one bad row cannot abort the batch).
 */
export async function reconcilePendingMediaObjects(
  options: ReconcilePendingOptions,
): Promise<PendingReconcileReport> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_PENDING_MAX_AGE_MS;
  const dryRun = options.dryRun ?? true;
  const limit = options.limit ?? DEFAULT_PENDING_RECONCILE_LIMIT;

  const pending = await listMediaObjectsByStatus(options.pool, "pending");
  const examined = pending.slice(0, limit);

  const findings: PendingReconcileFinding[] = [];
  let markedReady = 0;
  let deletedRows = 0;
  let skipped = 0;

  for (const row of examined) {
    const createdMs = Date.parse(row.created_at);
    if (Number.isNaN(createdMs)) {
      skipped += 1;
      findings.push({ id: row.id, action: "skip", reason: "unparseable-created-at" });
      continue;
    }
    if (now - createdMs < maxAgeMs) {
      skipped += 1;
      findings.push({ id: row.id, action: "skip", reason: "too-young" });
      continue;
    }

    // Verified presence probe. Absence is only trusted when `exists` is false.
    const present = await options.objects.exists(row.storage_key);
    const action: PendingReconcileAction = present ? "mark-ready" : "delete-row";
    const reason = present ? "object-present" : "object-missing";

    if (dryRun) {
      findings.push({ id: row.id, action, reason: `dry-run:${reason}` });
      if (present) markedReady += 1;
      else deletedRows += 1;
      continue;
    }

    try {
      if (present) {
        await markMediaObjectReady(options.pool, row.id);
        markedReady += 1;
      } else {
        await deleteMediaObjectRow(options.pool, row.id);
        deletedRows += 1;
      }
      findings.push({ id: row.id, action, reason });
    } catch {
      skipped += 1;
      findings.push({ id: row.id, action: "skip", reason: "apply-failed" });
    }
  }

  return {
    dryRun,
    scanned: examined.length,
    markedReady,
    deletedRows,
    skipped,
    findings,
  };
}
