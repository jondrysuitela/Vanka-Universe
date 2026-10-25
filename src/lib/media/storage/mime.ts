/**
 * Shared media MIME helpers (Tahap 4G.40D-2 extraction).
 *
 * Pure, dependency-free functions used by BOTH storage providers so the
 * authoritative MIME table and magic-byte sniffing can never diverge between
 * filesystem and R2. Previously these lived inside `filesystem.ts`; the
 * behavior is unchanged, only relocated.
 *
 * This module performs no I/O and imports no provider code.
 */

export const MIME_MAP: Record<string, { ext: string; kind: "image" | "video" | "audio" }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/gif": { ext: "gif", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  // Background music. Kept in its own `audio` kind so it can never be mistaken
  // for a photo/video in a gallery listing.
  "audio/mpeg": { ext: "mp3", kind: "audio" },
};

/** Determine the real MIME from leading bytes; null when unsupported. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 4) === "GIF8") {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    return "video/mp4";
  }
  // MP3 — three accepted signatures, because encoders differ:
  //   ID3v2 tag ("ID3")            — the common case for tagged files
  //   MPEG frame sync FF Ex       — no tag, layer II/III
  //   MPEG frame sync FF Fx       — no tag, layer I
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") {
    return "audio/mpeg";
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return null;
}

/** Server-determined file extension for a supported MIME, or null. */
export function extensionForMime(mime: string): string | null {
  return MIME_MAP[mime]?.ext ?? null;
}
