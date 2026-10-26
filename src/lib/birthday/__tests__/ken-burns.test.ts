import { describe, expect, it } from "vitest";

import {
  GALLERY_TRANSITION_S,
  KEN_BURNS_DURATION_S,
  KEN_BURNS_SCALE_MAX,
  KEN_BURNS_SCALE_RANGE,
  isSameItem,
  kenBurnsMotion,
} from "@/lib/birthday/ken-burns";

describe("kenBurnsMotion", () => {
  it("zooms IN then OUT, so the loop has no visible snap", () => {
    const { scale } = kenBurnsMotion();
    // The cycle must start and end at the same scale — otherwise every repeat
    // jumps from 1.08 back to 1.0.
    expect(scale[0]).toBe(scale[2]);
    expect(scale[1]).toBeGreaterThan(scale[0]);
  });

  it("supports stable per-photo zoom ranges", () => {
    const subtle = kenBurnsMotion(0.04).scale;
    const bold = kenBurnsMotion(0.08).scale;

    expect(subtle[0]).toBe(subtle[2]);
    expect(bold[0]).toBe(bold[2]);
    expect(subtle[1]).toBe(1.04);
    expect(bold[1]).toBe(1.08);
  });

  it("keeps the zoom subtle (at most 8%)", () => {
    const { scale } = kenBurnsMotion();
    expect(KEN_BURNS_SCALE_RANGE).toBeLessThanOrEqual(0.1);
    expect(scale[1]).toBe(KEN_BURNS_SCALE_MAX);
    expect(scale[1]).toBeCloseTo(1.08, 5);
  });

  it("drifts slowly — long enough to read as a photograph, not a video", () => {
    expect(KEN_BURNS_DURATION_S).toBeGreaterThanOrEqual(20);
    expect(kenBurnsMotion().duration).toBe(KEN_BURNS_DURATION_S);
  });

});

describe("crossfade helpers", () => {
  it("uses a 1500ms crossfade for each scrapbook photo", () => {
    expect(GALLERY_TRANSITION_S).toBe(1.5);
  });

  it("detects the same item, so no crossfade runs for an unchanged photo", () => {
    expect(isSameItem("a", "a")).toBe(true);
    expect(isSameItem("a", "b")).toBe(false);
    expect(isSameItem(null, "a")).toBe(false);
  });
});
