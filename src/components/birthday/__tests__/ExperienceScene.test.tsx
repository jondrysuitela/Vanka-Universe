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
          for (const prop of ["initial", "animate", "exit", "variants", "custom", "transition"]) {
            delete elementProps[prop];
          }
          return createElement(tag, elementProps);
        },
    },
  );
  return { AnimatePresence: ({ children }: { children: React.ReactNode }) => children, motion, useReducedMotion: () => false };
});

import ExperienceScene from "@/components/birthday/ExperienceScene";
import type { GalleryItem } from "@/lib/birthday/gallery/client-sync";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const galleryItems: GalleryItem[] = [
  {
    id: "photo-one",
    kind: "image",
    mime: "image/jpeg",
    name: "first.jpg",
    title: "Foto pertama",
    description: null,
    takenAt: null,
    createdAt: "",
  },
  {
    id: "photo-two",
    kind: "image",
    mime: "image/jpeg",
    name: "second.jpg",
    title: "Foto kedua",
    description: null,
    takenAt: null,
    createdAt: "",
  },
];

describe("ExperienceScene memory gallery", () => {
  it("changes photos only when a gallery control is pressed", () => {
    vi.useFakeTimers();
    render(
      <ExperienceScene
        active={2}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onRestart={vi.fn()}
        galleryItems={galleryItems}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buka kotak kenangan dan lihat galeri" }));
    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.getByText("Foto pertama")).toBeTruthy();
    expect(screen.getByTestId("birthday-ambient-celebration")).toBeTruthy();
    expect(screen.getByTestId("memory-scrapbook-stage").className).toContain("aspect-[4/5]");
    expect(screen.getByTestId("memory-scrapbook-stage").className).toContain("max-w-2xl");
    expect(screen.getByTestId("memory-scrapbook-photo").className).toContain("h-full");
    expect(screen.getByTestId("memory-scrapbook-photo").className).toContain("w-[76%]");
    expect(
      screen.getByTestId("memory-scrapbook-photo").querySelector("figure")?.className,
    ).not.toContain("border");
    expect(screen.getByAltText("Foto pertama").className).toContain("object-contain");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("Foto pertama")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Foto atau video berikutnya" }));
    expect(screen.getByText("Foto kedua")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Foto atau video sebelumnya" }));
    expect(screen.getByText("Foto pertama")).toBeTruthy();
  });

  it("keeps the celebration effects active throughout the letter scene", () => {
    render(
      <ExperienceScene
        active={1}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        onRestart={vi.fn()}
        galleryItems={galleryItems}
      />,
    );

    expect(screen.getByTestId("birthday-ambient-celebration")).toBeTruthy();
  });
});
