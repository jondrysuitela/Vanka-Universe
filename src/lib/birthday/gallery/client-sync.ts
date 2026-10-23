/**
 * Birthday-gallery client sync (Tahap 4G.42) — browser-side decision layer.
 *
 * PURE: performs no rendering and no storage; the caller injects a
 * `fetch`-like function. All network outcomes are mapped to explicit, honest
 * results so the experience UI can never mistake "gate still locked" or "server
 * down" for an empty gallery, and can never fake a reveal.
 *
 * Contracts (implemented in `src/app/api/birthday/gallery/route.ts`):
 *  - public  GET /api/birthday/gallery       -> 200 { data } | 403 GALLERY_LOCKED
 *  - preview GET /api/birthday/gallery?preview=1 -> 200 { data } | 401 | 403 FORBIDDEN
 *  - errors                                  -> { error: { code, message, details? } }
 *
 * The item bytes are NOT fetched here; they come from
 * `/api/birthday/gallery/media/[id]` (revealed media only).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GalleryItem {
  id: string;
  kind: "image" | "video";
  mime: string;
  name: string;
  title: string | null;
  description: string | null;
  /** Capture date (YYYY-MM-DD) when the admin set one. */
  takenAt: string | null;
  createdAt: string;
}

export interface BirthdayGalleryData {
  year: number;
  age: number;
  revealed: boolean;
  revealAt: string;
  items: GalleryItem[];
}

export type GalleryLoadResult =
  | { status: "ok"; data: BirthdayGalleryData }
  | { status: "locked" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

/**
 * Build the gallery endpoint URL. `preview=true` requests the admin preview
 * (session + operator role required, reveal gate bypassed).
 */
export function galleryUrl(preview: boolean, year?: number): string {
  const params: string[] = [];
  if (preview) params.push("preview=1");
  if (year !== undefined) params.push(`year=${year}`);
  return params.length > 0 ? `/api/birthday/gallery?${params.join("&")}` : "/api/birthday/gallery";
}

function isGalleryData(value: unknown): value is BirthdayGalleryData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<BirthdayGalleryData>;
  return (
    typeof data.year === "number" &&
    typeof data.age === "number" &&
    typeof data.revealed === "boolean" &&
    typeof data.revealAt === "string" &&
    Array.isArray(data.items)
  );
}

/**
 * Load the gallery. NEVER throws and NEVER fabricates items.
 *  - 403         -> `locked` (the birthday has not happened yet).
 *  - 401/403 on preview -> `unauthorized` (session missing / wrong role).
 *  - 5xx/network -> `unavailable` (never an empty gallery, so the UI cannot
 *                   mistake "server down" for "no memories").
 */
export async function loadBirthdayGallery(
  fetcher: FetchLike,
  preview: boolean,
  /** Cycle year (full year, e.g. 2026). Omitted = the endpoint's default cycle. */
  year?: number,
): Promise<GalleryLoadResult> {
  let res: Response;
  try {
    res = await fetcher(galleryUrl(preview, year), { headers: { accept: "application/json" } });
  } catch {
    return { status: "unavailable" };
  }

  const isPreviewAuthFailure = preview && (res.status === 401 || res.status === 403);
  if (isPreviewAuthFailure || res.status === 401) return { status: "unauthorized" };
  if (res.status === 403) return { status: "locked" };
  if (!res.ok) return { status: "unavailable" };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "unavailable" };
  }

  const data = (body as { data?: unknown } | null)?.data;
  if (!isGalleryData(data)) return { status: "unavailable" };
  return { status: "ok", data };
}