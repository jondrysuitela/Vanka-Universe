import { describe, expect, it, vi } from "vitest";

import {
  MediaMetadataIntegrityError,
  MediaObjectsUnavailableError,
} from "@/lib/media/db/errors";
import { describeMediaStoreError } from "@/lib/media/storage/error-mapping";

describe("describeMediaStoreError", () => {
  it("maps a missing table to 503 MEDIA_STORE_NOT_MIGRATED (fail-closed)", () => {
    const mapped = describeMediaStoreError(new MediaObjectsUnavailableError());
    expect(mapped).toEqual({
      status: 503,
      code: "MEDIA_STORE_NOT_MIGRATED",
      message: "Penyimpanan metadata media belum siap.",
    });
  });

  it("maps an integrity failure to 500 MEDIA_INTEGRITY_ERROR", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mapped = describeMediaStoreError(new MediaMetadataIntegrityError("boom"));
      expect(mapped?.status).toBe(500);
      expect(mapped?.code).toBe("MEDIA_INTEGRITY_ERROR");
    } finally {
      spy.mockRestore();
    }
  });

  it("logs only a safe category, never the internal message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      describeMediaStoreError(
        new MediaMetadataIntegrityError("bucket=secret key=media/x.png stacktrace"),
      );
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("secret");
      expect(logged).not.toContain("media/x.png");
      expect(logged).not.toContain("stacktrace");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not log for the 503 case", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      describeMediaStoreError(new MediaObjectsUnavailableError());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns null for unrelated errors (route keeps its generic 500)", () => {
    expect(describeMediaStoreError(new Error("something else"))).toBeNull();
    expect(describeMediaStoreError("not an error")).toBeNull();
    expect(describeMediaStoreError(undefined)).toBeNull();
  });
});
