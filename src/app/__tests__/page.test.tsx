// @vitest-environment jsdom
import "./jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import Home from "@/app/page";

/**
 * The landing page gates the Vanka Experience by DATE (27 October 2026). The
 * clock is controlled here so both sides of the gate are covered:
 *  - before the reveal the chapter must NOT be a link (it only announces the
 *    opening date), and
 *  - from the reveal instant on it is the normal link again.
 */

const REVEAL = new Date("2026-10-26T15:00:00.000Z").getTime();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function installFetchSpy(): ReturnType<typeof vi.fn> {
  const spy = vi.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = spy;
  return spy;
}

function linkByHref(container: HTMLElement, href: string): HTMLAnchorElement {
  const link = Array.from(container.querySelectorAll("a")).find(
    (anchor) => anchor.getAttribute("href") === href,
  );
  if (!link) throw new Error(`Missing link: ${href}`);
  return link as HTMLAnchorElement;
}

/** Freeze the clock and let the page's date check run. */
async function renderAt(nowMs: number): Promise<HTMLElement> {
  vi.setSystemTime(new Date(nowMs));
  installFetchSpy();
  const { container } = render(<Home />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  return container;
}

describe("public dashboard chapters — before the reveal", () => {
  it("does not link to /birthday-experience at all", async () => {
    const container = await renderAt(REVEAL - 60_000);

    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).not.toContain("/birthday-experience");
  });

  it("shows the opening date on the Birthday Experience card instead of the CTA", async () => {
    await renderAt(REVEAL - 60_000);

    expect(screen.getByRole("heading", { name: "Birthday Experience" })).toBeTruthy();
    const card = screen
      .getByRole("heading", { name: "Birthday Experience" })
      .closest("button");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Terbuka 27 Oktober 2026");
    expect(card?.textContent).not.toContain("Open the Birthday Experience");
  });

  it("still renders the other two chapters unchanged", async () => {
    const container = await renderAt(REVEAL - 60_000);

    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(linkByHref(container, "/memory-archive").textContent).toContain(
      "Visit the Memory Archive",
    );
    expect(linkByHref(container, "/arsip-ibu").textContent).toContain("Dilindungi PIN");
    expect(screen.getByRole("heading", { name: "Three chapters, one universe" })).toBeTruthy();
  });

  it("opens the announcement dialog and closes it with the button", async () => {
    const container = await renderAt(REVEAL - 60_000);
    const card = screen
      .getByRole("heading", { name: "Birthday Experience" })
      .closest("button") as HTMLButtonElement;

    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      card.click();
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("27 Oktober 2026");
    expect(dialog.textContent).toContain("Vanka Experience akan terbuka");

    await act(async () => {
      screen.getByRole("button", { name: "Mengerti" }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });
});

describe("public dashboard chapters — from the reveal instant on", () => {
  it("is the normal link with the original CTA", async () => {
    const container = await renderAt(REVEAL);

    const birthday = linkByHref(container, "/birthday-experience");
    expect(birthday.textContent).toContain("Open the Birthday Experience");
    expect(birthday.textContent).not.toContain("Terbuka");
    expect(birthday.querySelector("svg")).toBeNull();
  });

  it("renders all three chapter links", async () => {
    const container = await renderAt(REVEAL);

    expect(
      Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href")),
    ).toEqual(["/birthday-experience", "/memory-archive", "/arsip-ibu"]);
    for (const title of ["Birthday Experience", "Memory Archive", "Arsip Privat"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
  });
});

describe("public dashboard — shared behaviour", () => {
  it("stays public: no PIN prompt, no inputs, and no API call", async () => {
    vi.setSystemTime(new Date(REVEAL - 60_000));
    const fetchSpy = installFetchSpy();
    const { container } = render(<Home />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/masukkan pin|pin salah/i);
  });

  it("uses a balanced responsive grid", async () => {
    const container = await renderAt(REVEAL);

    const grid = linkByHref(container, "/arsip-ibu").parentElement;
    expect(grid?.className).toContain("md:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
  });

  it("gives each card a distinct, plain box-shadow glow that grows on hover/focus", async () => {
    const container = await renderAt(REVEAL);

    const glows: Array<[string, string]> = [
      ["/birthday-experience", "rgba(139,92,246"],
      ["/memory-archive", "rgba(96,165,250"],
      ["/arsip-ibu", "rgba(233,198,124"],
    ];

    for (const [href, colour] of glows) {
      const className = linkByHref(container, href).className;
      // Thin glow at rest, stronger on hover and on keyboard focus.
      expect(className).toContain(colour);
      expect(className).toContain("hover:shadow-");
      expect(className).toContain("focus-visible:shadow-");
      // Respects reduced motion; pure box-shadow (no blur/overflow tricks).
      expect(className).toContain("motion-reduce:transition-none");
      expect(className).toContain("shadow-[");
    }
  });

  it("keeps the lock glyph on the gated card too", async () => {
    const container = await renderAt(REVEAL - 60_000);

    const card = screen
      .getByRole("heading", { name: "Birthday Experience" })
      .closest("button");
    const glyph = card?.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("h3")).toHaveLength(3);
  });
});
