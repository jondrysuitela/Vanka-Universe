/**
 * Media reference checks (Tahap 4G.11 / 4G.12).
 *
 * Before deleting a stored file we ask every REGISTERED probe whether it still
 * references the media id. Deleting a referenced file would orphan that
 * reference, so deletion is refused in that case.
 *
 * FAIL-CLOSED: an empty registry means "we have no way to verify", NOT "there
 * are no references". Likewise, if any probe throws, the status is unknown.
 * Both cases yield `unverifiable`, and the caller must refuse deletion. Only a
 * positive `clear` verdict — produced by at least one registered probe that
 * completed successfully and found nothing — permits a delete.
 *
 * No persistent content/archive store references filesystem media ids today, so
 * NO probe is registered: deletion is therefore refused (unverifiable) until a
 * real store arrives and registers a probe via `registerMediaReferenceProbe`.
 * That is deliberate and honest, not a silent bypass.
 */

export interface MediaReference {
  /** Which store/domain references the media. */
  source: string;
  /** Human-readable detail (e.g. the referencing record title). */
  detail: string;
}

export type MediaReferenceVerdict =
  | { verdict: "clear" }
  | { verdict: "referenced"; references: MediaReference[] }
  | { verdict: "unverifiable"; reason: string };

type MediaReferenceProbe = (id: string) => Promise<MediaReference[]>;

const PROBES: MediaReferenceProbe[] = [];

/** Register a probe. Only add probes for stores that REALLY persist references. */
export function registerMediaReferenceProbe(probe: MediaReferenceProbe): void {
  PROBES.push(probe);
}

/**
 * Determine whether a media id is safe to delete.
 *
 * - No registered probe        -> `unverifiable` (fail-closed; cannot prove safety).
 * - Any probe rejects/throws   -> `unverifiable` (fail-closed).
 * - Some probe reports a ref   -> `referenced`.
 * - All probes ran, none found -> `clear`.
 */
export async function checkMediaReferences(id: string): Promise<MediaReferenceVerdict> {
  if (PROBES.length === 0) {
    return { verdict: "unverifiable", reason: "Tidak ada sumber referensi yang terdaftar." };
  }

  try {
    const results = await Promise.all(PROBES.map((probe) => probe(id)));
    const references = results.flat();
    if (references.length > 0) return { verdict: "referenced", references };
    return { verdict: "clear" };
  } catch {
    return { verdict: "unverifiable", reason: "Pemeriksaan referensi gagal dijalankan." };
  }
}
