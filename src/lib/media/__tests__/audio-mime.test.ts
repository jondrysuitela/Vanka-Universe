import { describe, expect, it } from "vitest";

import { MIME_MAP, extensionForMime, sniffMime } from "@/lib/media/storage/mime";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, maxBytesForKind } from "@/lib/media/storage/types";

/**
 * MP3 support in the shared media layer.
 *
 * This is the guard that matters: before it, `sniffMime` only knew images and
 * MP4, so every MP3 upload was rejected with 415 — the background-music feature
 * could not work at all, no matter what the admin page did.
 */

/** Minimal byte builders — the sniffer only reads the leading bytes. */
function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

function id3Tag(): Buffer {
  // "ID3" + a 10-byte header, padded so the buffer is long enough to read.
  return Buffer.concat([Buffer.from("ID3"), Buffer.alloc(20)]);
}

function mpegFrameSync(): Buffer {
  // 0xFF 0xFB is the usual MPEG-1 Layer III frame header start.
  return Buffer.concat([bytes(0xff, 0xfb, 0x90, 0x00), Buffer.alloc(20)]);
}

function mpegFrameSyncLayer1(): Buffer {
  return Buffer.concat([bytes(0xff, 0xfe, 0x90, 0x00), Buffer.alloc(20)]);
}

describe("sniffMime — MP3", () => {
  it("recognises a tagged MP3 (ID3v2 header)", () => {
    expect(sniffMime(id3Tag())).toBe("audio/mpeg");
  });

  it("recognises an untagged MP3 from the MPEG frame sync", () => {
    expect(sniffMime(mpegFrameSync())).toBe("audio/mpeg");
  });

  it("recognises the layer-I frame sync", () => {
    expect(sniffMime(mpegFrameSyncLayer1())).toBe("audio/mpeg");
  });

  it("still recognises the formats that worked before", () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from("GIF89a"))).toBe("image/gif");
  });

  it("still rejects unknown bytes", () => {
    expect(sniffMime(Buffer.from("not a real file"))).toBeNull();
    expect(sniffMime(bytes(0xff))).toBeNull();
  });
});

describe("audio metadata", () => {
  it("maps audio/mpeg to an mp3 extension and the `audio` kind", () => {
    expect(MIME_MAP["audio/mpeg"]).toEqual({ ext: "mp3", kind: "audio" });
    expect(extensionForMime("audio/mpeg")).toBe("mp3");
  });

  it("gives audio its own size cap, larger than an image", () => {
    expect(maxBytesForKind("audio")).toBe(MAX_AUDIO_BYTES);
    expect(MAX_AUDIO_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
    expect(MAX_AUDIO_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
  });

  it("keeps the existing caps for images and videos", () => {
    expect(maxBytesForKind("image")).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesForKind("video")).toBe(MAX_VIDEO_BYTES);
  });
});
