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

/**
 * Longest allowed edge after shrinking.
 *
 * SIZED FOR THE ACTUAL RENDER, not for a 1440p desktop. No photo in the app is
 * drawn wider than the memory-box frame / letter opener (~382 CSS px at a 2×
 * device pixel ratio ≈ 766 px); the old 2560 px cap left files several times
 * larger than anything that reaches the screen, which is exactly what made
 * sliding between photos stutter. 1600 px still leaves headroom for a full-width
 * view on a large display while cutting bytes sharply.
 */
export const MAX_EDGE_PX = 1600;

/**
 * Re-encode quality (0–1).
 *
 * 0.82 is the point where the downscale still looks clean at display size but a
 * JPEG stops carrying detail the screen never shows. Paired with the smaller
 * cap below this is a large byte cut, not a small one.
 */
export const QUALITY = 0.82;

/**
 * Images at or below this are already cheap to render; leave them untouched.
 *
 * Lowered from 400 KB: the gallery now draws at most ~766 device px, so a
 * 300 KB photo can still be a 2400 px source — exactly the case that stalls a
 * slide. Over-resolved files are now re-sampled even when their bytes look
 * modest.
 */
export const SKIP_BELOW_BYTES = 200 * 1024;

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

  const maxEdge = options.maxEdge ?? MAX_EDGE_PX;
  const quality = options.quality ?? QUALITY;

  // The byte gate is only a cheap early-out for SMALL files; a big file may
  // still be too over-resolved to skip, so the real decision is made after we
  // know the pixel dimensions below.
  if (file.type === "image/gif") return unchanged;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return unchanged;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height, maxEdge);
    const needsResize = width !== bitmap.width || height !== bitmap.height;
    // Fits the cap AND already small in bytes: keep the original bytes.
    if (!needsResize && file.size <= SKIP_BELOW_BYTES) {
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
