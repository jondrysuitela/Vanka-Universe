import { describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the fail-closed reference verdicts. `vi.resetModules()`
 * gives each test a fresh module instance so the probe registry starts empty.
 */
async function freshModule() {
  vi.resetModules();
  return import("@/lib/media/references");
}

describe("checkMediaReferences verdicts", () => {
  it("is unverifiable when no probe is registered (empty registry ≠ safe)", async () => {
    const refs = await freshModule();
    const verdict = await refs.checkMediaReferences("media-1");
    expect(verdict.verdict).toBe("unverifiable");
  });

  it("is clear when a registered probe runs and finds nothing", async () => {
    const refs = await freshModule();
    refs.registerMediaReferenceProbe(async () => []);
    const verdict = await refs.checkMediaReferences("media-1");
    expect(verdict.verdict).toBe("clear");
  });

  it("is referenced when a probe finds a reference", async () => {
    const refs = await freshModule();
    refs.registerMediaReferenceProbe(async () => [{ source: "content", detail: "Konten ulang tahun" }]);
    const verdict = await refs.checkMediaReferences("media-1");
    expect(verdict.verdict).toBe("referenced");
    if (verdict.verdict === "referenced") {
      expect(verdict.references).toHaveLength(1);
      expect(verdict.references[0].source).toBe("content");
    }
  });

  it("is unverifiable when a probe throws (fail-closed)", async () => {
    const refs = await freshModule();
    refs.registerMediaReferenceProbe(async () => {
      throw new Error("reference store unavailable");
    });
    const verdict = await refs.checkMediaReferences("media-1");
    expect(verdict.verdict).toBe("unverifiable");
  });

  it("treats any reference from multiple probes as referenced", async () => {
    const refs = await freshModule();
    refs.registerMediaReferenceProbe(async () => []);
    refs.registerMediaReferenceProbe(async () => [{ source: "archive", detail: "Arsip privat" }]);
    const verdict = await refs.checkMediaReferences("media-1");
    expect(verdict.verdict).toBe("referenced");
  });

  it("passes the id through to probes", async () => {
    const refs = await freshModule();
    const probe = vi.fn(async () => []);
    refs.registerMediaReferenceProbe(probe);
    await refs.checkMediaReferences("media-xyz");
    expect(probe).toHaveBeenCalledWith("media-xyz");
  });
});
