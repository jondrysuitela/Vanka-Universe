import { describe, expect, it } from "vitest";

import {
  MAX_EDGE_PX,
  SKIP_BELOW_BYTES,
  compressForUpload,
  compressImageFile,
  maxBytesFor,
  scaledDimensions,
  shouldCompressImage,
} from "@/lib/media/compress";

/**
 * Upload shrinking. These are the pure decisions; the actual canvas re-encode
 * runs in the browser and is exercised in the app, not here.
 */

describe("scaledDimensions", () => {
  it("scales the longest edge down to the cap and keeps the aspect ratio", () => {
    expect(scaledDimensions(6000, 4000)).toEqual({ width: 2560, height: 1707 });
    expect(scaledDimensions(4000, 6000)).toEqual({ width: 1707, height: 2560 });
  });

  it("never upscales", () => {
    expect(scaledDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(scaledDimensions(MAX_EDGE_PX, 100)).toEqual({ width: MAX_EDGE_PX, height: 100 });
  });

  it("keeps a usable size for extreme panoramas", () => {
    const { width, height } = scaledDimensions(20000, 40);
    expect(width).toBe(MAX_EDGE_PX);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe("shouldCompressImage", () => {
  it("compresses big JPEG/PNG/WebP photos", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(shouldCompressImage({ type, size: 5 * 1024 * 1024 })).toBe(true);
    }
  });

  it("leaves GIFs alone so animation survives", () => {
    expect(shouldCompressImage({ type: "image/gif", size: 9 * 1024 * 1024 })).toBe(false);
  });

  it("skips files that are already small", () => {
    expect(shouldCompressImage({ type: "image/jpeg", size: SKIP_BELOW_BYTES })).toBe(false);
  });

  it("ignores non-image types", () => {
    expect(shouldCompressImage({ type: "video/mp4", size: 30 * 1024 * 1024 })).toBe(false);
  });
});

describe("compressForUpload", () => {
  it("passes videos through untouched", async () => {
    const file = new File([new Uint8Array(2048)], "clip.mp4", { type: "video/mp4" });
    const result = await compressForUpload(file, "video");

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.originalBytes).toBe(2048);
  });

  it("returns the original file outside a browser (no canvas)", async () => {
    // The unit tests run in the node environment: `document` is undefined, so
    // this is exactly the "cannot decode here" path.
    const file = new File([new Uint8Array(1024)], "photo.jpg", { type: "image/jpeg" });
    const result = await compressImageFile(file);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
  });
});

describe("maxBytesFor", () => {
  it("keeps the existing per-kind caps", () => {
    expect(maxBytesFor("image")).toBe(10 * 1024 * 1024);
    expect(maxBytesFor("video")).toBe(50 * 1024 * 1024);
  });
});
