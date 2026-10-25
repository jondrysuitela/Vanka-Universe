// @vitest-environment jsdom
import "../../../app/__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        function MotionElement(props: Record<string, unknown>) {
          const elementProps = { ...props };
          delete elementProps.initial;
          delete elementProps.animate;
          delete elementProps.transition;
          return createElement(tag, elementProps);
        },
    },
  );
  return { motion, useReducedMotion: () => false };
});

import BirthdayCountdown from "@/components/birthday/BirthdayCountdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BirthdayCountdown", () => {
  it("puts out the candles at midnight and then offers the gift", async () => {
    vi.useFakeTimers();
    const revealAt = Date.parse("2026-10-26T15:00:00.000Z");
    const onOpenGift = vi.fn();
    const { rerender, container } = render(
      <BirthdayCountdown revealAt={revealAt} now={revealAt - 1000} onOpenGift={onOpenGift} />,
    );

    expect(screen.getByText("00:01")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Buka Kado Vanka" })).toBeNull();

    rerender(<BirthdayCountdown revealAt={revealAt} now={revealAt} onOpenGift={onOpenGift} />);
    expect(screen.getByRole("heading", { name: "Selamat Ulang Tahun, Vanka" })).toBeTruthy();
    expect(screen.getByText("27 Oktober · 00.00 WIT")).toBeTruthy();
    expect(container.querySelectorAll('path[fill="#ffd36e"]')).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(4200);
    });
    fireEvent.click(screen.getByRole("button", { name: "Buka Kado Vanka" }));
    expect(onOpenGift).toHaveBeenCalledOnce();
  });
});
