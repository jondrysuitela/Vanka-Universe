// @vitest-environment jsdom
import "../../../app/__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import GlitterBurst from "@/components/birthday/GlitterBurst";

/**
 * The full-screen glitter transition. It is decorative and must never intercept
 * a click — that is the one property worth locking down, since it covers the
 * whole viewport while the box/letter/memory box opens.
 */

afterEach(cleanup);

function burstLayer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("div.pointer-events-none.fixed.inset-0");
}

describe("GlitterBurst", () => {
  it("renders nothing when inactive", () => {
    const { container } = render(<GlitterBurst active={false} />);
    expect(burstLayer(container)).toBeNull();
  });

  it("covers the viewport without intercepting pointer events", () => {
    const { container } = render(<GlitterBurst active count={8} />);
    const layer = burstLayer(container);

    expect(layer).not.toBeNull();
    expect(layer?.className).toContain("pointer-events-none");
    expect(layer?.className).toContain("fixed");
    expect(layer?.className).toContain("inset-0");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders one spark per particle plus the centre flash", () => {
    const { container } = render(<GlitterBurst active count={12} />);

    const sparks = container.querySelectorAll("span.absolute.left-1\\/2.top-1\\/2");
    expect(sparks).toHaveLength(12);
  });

  it("removes itself after its duration, even though `active` stays true", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<GlitterBurst active durationMs={1600} count={4} />);
      expect(burstLayer(container)).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1700);
      });

      // The caller never resets `active`; the layer must still go away.
      expect(burstLayer(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
