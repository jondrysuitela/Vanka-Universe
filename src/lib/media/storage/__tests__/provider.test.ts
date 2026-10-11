import { afterEach, describe, expect, it, vi } from "vitest";

// The storage modules are server-only and pull the auth guard (via filesystem.ts);
// neither a database nor the Next runtime is needed here.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("database is not used in this isolated test");
  },
}));

import {
  MEDIA_STORAGE_DRIVERS,
  getMediaStore,
  resolveMediaStorageDriver,
} from "@/lib/media/storage";
import { filesystemMediaStore } from "@/lib/media/storage/filesystem";
import { R2ConfigError } from "@/lib/media/storage/r2";
import { StorageConfigError } from "@/lib/media/storage/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("media storage provider selection", () => {
  it("defaults to filesystem when MEDIA_STORAGE_DRIVER is absent", () => {
    const saved = process.env.MEDIA_STORAGE_DRIVER;
    delete process.env.MEDIA_STORAGE_DRIVER;
    try {
      expect(resolveMediaStorageDriver()).toBe("filesystem");
      expect(getMediaStore()).toBe(filesystemMediaStore);
    } finally {
      if (saved !== undefined) process.env.MEDIA_STORAGE_DRIVER = saved;
    }
  });

  it("defaults to filesystem when MEDIA_STORAGE_DRIVER is empty", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "");
    expect(resolveMediaStorageDriver()).toBe("filesystem");
    expect(getMediaStore()).toBe(filesystemMediaStore);
  });

  it("returns the filesystem store for an explicit value", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "filesystem");
    expect(resolveMediaStorageDriver()).toBe("filesystem");
    expect(getMediaStore()).toBe(filesystemMediaStore);
  });

  it("lists the implemented drivers", () => {
    expect(MEDIA_STORAGE_DRIVERS).toEqual(["filesystem", "r2", "db-r2"]);
  });

  it("fails closed for r2 without complete R2 configuration — never falls back", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "r2");
    expect(() => resolveMediaStorageDriver()).not.toThrow();
    expect(() => getMediaStore()).toThrow(R2ConfigError);
  });

  it("fails closed for db-r2 without R2 configuration — never falls back", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "db-r2");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(() => resolveMediaStorageDriver()).not.toThrow();
    expect(() => getMediaStore()).toThrow(R2ConfigError);
  });

  it("never returns a store for a misconfigured db-r2 (no filesystem fallback)", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "db-r2");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    let returned: unknown = "sentinel";
    try {
      returned = getMediaStore();
    } catch {
      returned = null;
    }
    expect(returned).toBeNull();
    expect(returned).not.toBe(filesystemMediaStore);
  });

  it("fails closed for an unknown provider value", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "banana");
    expect(() => getMediaStore()).toThrow(StorageConfigError);
    try {
      getMediaStore();
    } catch (error) {
      expect((error as Error).name).toBe("StorageConfigError");
    }
  });

  it("does not leak a fallback store on a config error", () => {
    vi.stubEnv("MEDIA_STORAGE_DRIVER", "gcs");
    let returned: unknown = "sentinel";
    try {
      returned = getMediaStore();
    } catch {
      returned = null;
    }
    expect(returned).toBeNull();
  });
});
