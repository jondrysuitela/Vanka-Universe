// @vitest-environment jsdom
import "./jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import Home from "@/app/page";

afterEach(() => {
  cleanup();
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

describe("public dashboard chapters", () => {
  it("renders exactly three chapter cards with the correct hrefs", () => {
    installFetchSpy();
    const { container } = render(<Home />);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/birthday-experience",
      "/memory-archive",
      "/arsip-ibu",
    ]);

    for (const title of ["Birthday Experience", "Memory Archive", "Arsip Privat"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Three chapters, one universe" })).toBeTruthy();
  });

  it("points the Arsip Privat card at /arsip-ibu with a lock glyph and a PIN badge", () => {
    installFetchSpy();
    const { container } = render(<Home />);

    const archive = linkByHref(container, "/arsip-ibu");
    expect(archive.textContent).toContain("Arsip Privat");
    expect(archive.textContent).toContain("Dilindungi PIN");
    expect(archive.textContent).toContain("Buka Arsip Privat");
    // Lock glyph is present, decorative (hidden from AT).
    const glyph = archive.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the two original cards unchanged (no lock, same copy/CTAs)", () => {
    installFetchSpy();
    const { container } = render(<Home />);

    const birthday = linkByHref(container, "/birthday-experience");
    expect(birthday.textContent).toContain("Birthday Experience");
    expect(birthday.textContent).toContain("Open the Birthday Experience");
    expect(birthday.querySelector("svg")).toBeNull();

    const memory = linkByHref(container, "/memory-archive");
    expect(memory.textContent).toContain("Memory Archive");
    expect(memory.textContent).toContain("Visit the Memory Archive");
    expect(memory.querySelector("svg")).toBeNull();
  });

  it("stays public: no PIN prompt, no inputs, and no archive API call", () => {
    const fetchSpy = installFetchSpy();
    const { container } = render(<Home />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/masukkan pin|pin salah/i);
  });

  it("uses a balanced responsive grid", () => {
    installFetchSpy();
    const { container } = render(<Home />);

    const grid = linkByHref(container, "/arsip-ibu").parentElement;
    expect(grid?.className).toContain("md:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
  });

  it("gives each card a distinct, plain box-shadow glow that grows on hover/focus", () => {
    installFetchSpy();
    const { container } = render(<Home />);

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
});
