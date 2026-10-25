// @vitest-environment jsdom
import "../../../app/__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BIRTHDAY_CELEBRATION_MS } from "@/lib/birthday/countdown";

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
    expect(screen.getByRole("heading", { name: "Jam dua belas tepat!" })).toBeTruthy();
    expect(screen.getByText("A new orbit begins")).toBeTruthy();
    expect(screen.getByText(/Selamat Ulang Tahun/)).toBeTruthy();
    expect(screen.getByText("27 Oktober · 00.00 WIT")).toBeTruthy();
    expect(container.querySelectorAll('path[fill="#ffd36e"]')).toHaveLength(0);
    expect(screen.queryByTestId("birthday-ambient-celebration")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(BIRTHDAY_CELEBRATION_MS);
    });
    expect(screen.getByTestId("birthday-ambient-celebration").getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Buka Kado Vanka" }));
    expect(onOpenGift).toHaveBeenCalledOnce();
  });
});
