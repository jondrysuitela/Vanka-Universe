/**
 * Client-side media shrinking before upload.
 *
 * WHY: the media library rendered full-resolution originals in every card, so a
 * few 12 MP photos made the admin page slow and the public gallery heavy. Files
 * are now downscaled ONCE, in the browser, before they are uploaded — so every
 * place that reads them (admin grid, opening thumbnail, memory box, archive)
 * renders a modest image instead of a camera-sized one.
 *
 * QUALITY: the goal is "smaller, still sharp". Long edges beyond
 * `MAX_EDGE_PX` are resampled with the browser's high-quality smoothing and
 * re-encoded at `QUALITY`, which keeps detail at display sizes while cutting
 * bytes several-fold. A file that is already small enough is uploaded as-is.
 *
 * WHAT IS LEFT ALONE:
 *  - GIF — re-encoding would drop the animation.
 *  - Videos — the browser cannot transcode MP4 reliably; they keep their
 *    existing size cap (see `maxBytesFor`).
 *  - Anything the browser cannot decode (older formats, corrupt files): the
 *    original file is returned so an upload never fails because of this step.
 *
 * The server still sniffs magic bytes and enforces its own limits; this module
 * is a size optimisation, never a security boundary.
 */

export type CompressibleKind = "image" | "video";

/** Longest allowed edge after shrinking. 2560 px keeps 1440p-wide views sharp. */
export const MAX_EDGE_PX = 2560;

/** Re-encode quality (0–1). 0.86 is visually lossless at these sizes. */
export const QUALITY = 0.86;

/** Images below this are already cheap to render; leave them untouched. */
export const SKIP_BELOW_BYTES = 400 * 1024;

/** Never upscale, and never return something larger than the original. */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE_PX,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** True when an image is worth re-encoding (big, and not an animation). */
export function shouldCompressImage(file: { type: string; size: number }): boolean {
  if (file.type === "image/gif") return false;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return false;
  return file.size > SKIP_BELOW_BYTES;
}

/** Per-kind upload cap, unchanged by this module (images 10 MB, video 50 MB). */
export function maxBytesFor(kind: CompressibleKind): number {
  return kind === "image" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
}

export interface CompressResult {
  file: File;
  /** True when the returned file is a smaller re-encode. */
  compressed: boolean;
  originalBytes: number;
}

/** Output type for a source image: PNG keeps transparency, the rest become JPEG. */
function targetTypeFor(type: string): "image/png" | "image/jpeg" {
  return type === "image/png" ? "image/png" : "image/jpeg";
}

function renamedFor(name: string, mime: string): string {
  const ext = mime === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base}.${ext}`;
}

/**
 * Shrink one image file. NEVER throws: on any failure the ORIGINAL file is
 * returned, so compression can never block an upload.
 */
export async function compressImageFile(
  file: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<CompressResult> {
  const originalBytes = file.size;
  const unchanged: CompressResult = { file, compressed: false, originalBytes };

  if (typeof document === "undefined") return unchanged;
  if (!shouldCompressImage(file)) return unchanged;

  const maxEdge = options.maxEdge ?? MAX_EDGE_PX;
  const quality = options.quality ?? QUALITY;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxEdge);
    // Already small enough AND small in bytes: keep the original bytes.
    if (width === bitmap.width && height === bitmap.height && file.size <= SKIP_BELOW_BYTES) {
      bitmap.close();
      return unchanged;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return unchanged;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const mime = targetTypeFor(file.type);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), mime, quality);
    });
    if (!blob || blob.size === 0) return unchanged;

    // A re-encode that is not actually smaller is wasted work.
    if (blob.size >= originalBytes) return unchanged;

    return {
      file: new File([blob], renamedFor(file.name, mime), {
        type: mime,
        lastModified: file.lastModified,
      }),
      compressed: true,
      originalBytes,
    };
  } catch {
    return unchanged;
  }
}

/**
 * Shrink a file according to its kind. Videos and GIFs pass through unchanged
 * (documented above); images go through `compressImageFile`.
 */
export async function compressForUpload(
  file: File,
  kind: CompressibleKind,
): Promise<CompressResult> {
  if (kind !== "image") {
    return { file, compressed: false, originalBytes: file.size };
  }
  return compressImageFile(file);
}

/** Human-friendly summary for the admin toast, e.g. "4.2 MB → 780 KB". */
export function describeSavings(result: CompressResult): string {
  if (!result.compressed) return "";
  return `${formatBytes(result.originalBytes)} → ${formatBytes(result.file.size)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
