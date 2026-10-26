// @vitest-environment jsdom
import "../../../../app/__tests__/jsdom-stubs";

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
          for (const prop of ["initial", "animate", "exit", "variants", "custom", "transition"]) {
            delete elementProps[prop];
          }
          return createElement(tag, elementProps);
        },
    },
  );
  return { motion, useReducedMotion: () => false };
});

vi.mock("@/lib/birthday/cycle", () => ({
  cycleForDate: () => ({
    age: 1,
    year: 2026,
    start: new Date("2025-10-27T15:00:00.000Z"),
    revealAt: new Date("2026-10-26T15:00:00.000Z"),
    uploadEnd: new Date("2026-10-27T15:00:00.000Z"),
  }),
  latestRevealedCycle: () => null,
}));

vi.mock("@/components/birthday/BirthdayExperiencePlayer", () => ({
  default: ({
    autoStartMusic,
    autoOpenGift,
    onClose,
  }: {
    autoStartMusic: boolean;
    autoOpenGift: boolean;
    onClose: () => void;
  }) => (
    <div
      data-testid="birthday-experience-player"
      data-auto-start-music={String(autoStartMusic)}
      data-auto-open-gift={String(autoOpenGift)}
    >
      <button type="button" onClick={onClose}>
        Close experience
      </button>
    </div>
  ),
}));

import AdminDashboard from "@/components/admin/dashboard/AdminDashboard";
import { BIRTHDAY_CELEBRATION_MS, BIRTHDAY_COUNTDOWN_SECONDS } from "@/lib/birthday/countdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AdminDashboard birthday preview", () => {
  it("runs countdown, celebration, and experience as one preview flow", () => {
    vi.useFakeTimers();
    render(<AdminDashboard />);

    expect(screen.queryByRole("button", { name: "Preview Pengalaman" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Countdown + Experience" }));

    expect(screen.getByRole("dialog", { name: "Menuju ulang tahun Vanka" })).toBeTruthy();
    expect(screen.getByTestId("birthday-experience-player").getAttribute("data-auto-start-music")).toBe(
      "false",
    );
    expect(screen.getByTestId("birthday-experience-player").getAttribute("data-auto-open-gift")).toBe(
      "false",
    );

    act(() => {
      vi.advanceTimersByTime(BIRTHDAY_COUNTDOWN_SECONDS * 1000);
    });
    expect(screen.getByRole("heading", { name: "Jam dua belas tepat!" })).toBeTruthy();
    expect(screen.getByTestId("birthday-experience-player").getAttribute("data-auto-start-music")).toBe(
      "true",
    );

    act(() => {
      vi.advanceTimersByTime(BIRTHDAY_CELEBRATION_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Buka Kado Vanka" }));

    expect(screen.queryByRole("dialog", { name: "Menuju ulang tahun Vanka" })).toBeNull();
    expect(screen.getByTestId("birthday-experience-player").getAttribute("data-auto-start-music")).toBe(
      "true",
    );
    expect(screen.getByTestId("birthday-experience-player").getAttribute("data-auto-open-gift")).toBe(
      "true",
    );
  });
});
