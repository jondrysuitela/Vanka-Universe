// @vitest-environment jsdom
import "./jsdom-stubs";

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
          for (const prop of [
            "initial",
            "animate",
            "exit",
            "variants",
            "custom",
            "transition",
            "whileInView",
            "viewport",
          ]) {
            delete elementProps[prop];
          }
          return createElement(tag, elementProps);
        },
    },
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion,
    useReducedMotion: () => false,
  };
});

import Home from "@/app/page";
import { BIRTHDAY_CELEBRATION_MS } from "@/lib/birthday/countdown";

/**
 * The landing page follows the SAME date policy as the server:
 *
 *  - before 27 October 2026 00:00 WIT  → the chapter is a closed card;
 *  - on the birthday itself            → the experience covers the page as an
 *                                        overlay, and the card re-opens it;
 *  - from 28 October 00:00 WIT         → the card is a normal link again.
 *
 * The clock is frozen per test so each phase is exercised at its boundary.
 */

const REVEAL = new Date("2026-10-26T15:00:00.000Z").getTime(); // 27 Oct 00:00 WIT
const DAY_AFTER = new Date("2026-10-27T15:00:00.000Z").getTime(); // 28 Oct 00:00 WIT

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Stand-in for `fetch`. The experience player calls the public API; a 404 keeps
 * every loader on its honest "unavailable" path, so no real data is involved.
 */
function installFetchSpy(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({
    status: 404,
    ok: false,
    json: async () => ({ error: { code: "NOT_FOUND" } }),
  }));
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

function cardFor(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const card = heading.closest("button, a");
  if (!card) throw new Error(`Missing card for: ${title}`);
  return card as HTMLElement;
}

/** Freeze the clock and let the page's date check (and overlay load) settle. */
async function renderAt(nowMs: number): Promise<HTMLElement> {
  vi.setSystemTime(new Date(nowMs));
  installFetchSpy();
  if (nowMs >= REVEAL) {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  }
  const { container } = render(<Home />);
  // Frame 1: the page reads the clock. Frame 2: the overlay's player mounts and
  // reads its content. (Each deferred read is one animation frame.)
  await act(async () => {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await Promise.resolve();
    }
  });
  return container;
}

describe("landing page — before the birthday", () => {
  it("does not link to /birthday-experience at all", async () => {
    const container = await renderAt(REVEAL - 60_000);

    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).not.toContain("/birthday-experience");
  });

  it("shows the opening date on the Birthday Experience card instead of the CTA", async () => {
    await renderAt(REVEAL - 60_000);

    const card = cardFor("Birthday Experience");
    expect(card.tagName).toBe("BUTTON");
    expect(card.textContent).toContain("Terbuka 27 Oktober 2026");
    expect(card.textContent).not.toContain("Open the Birthday Experience");
  });

  it("opens the announcement dialog and closes it with the button", async () => {
    await renderAt(REVEAL - 60_000);
    const card = cardFor("Birthday Experience") as HTMLButtonElement;

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
  });

  it("never renders the experience overlay", async () => {
    await renderAt(REVEAL - 60_000);

    expect(document.querySelector('[aria-label*="Vanka Experience"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Buka Hadiah/i })).toBeNull();
  });

  it("still renders the other two chapters unchanged", async () => {
    const container = await renderAt(REVEAL - 60_000);

    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(linkByHref(container, "/memory-archive").textContent).toContain(
      "Visit the Memory Archive",
    );
    expect(linkByHref(container, "/arsip-ibu").textContent).toContain("Dilindungi PIN");
  });
});

describe("landing page — on the birthday itself", () => {
  it("starts the fifteen-second birthday countdown before midnight WIT", async () => {
    await renderAt(REVEAL - 15_000);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Menuju ulang tahun Vanka" })).toBeTruthy();
    expect(screen.getByText("00:15")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Buka Kado Vanka/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Buka hadiah/i })).toBeNull();
    const experience = document.querySelector('[aria-label="Vanka Experience — ulang tahun Vanka"]');
    expect(experience).not.toBeNull();
    expect(experience?.parentElement?.hasAttribute("hidden")).toBe(true);
  });

  it("starts public experience music at midnight and keeps one flow into the birthday scenes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(REVEAL - 15_000);
    installFetchSpy();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    render(<Home />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText("00:15")).toBeTruthy();
    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByRole("heading", { name: "Jam dua belas tepat!" })).toBeTruthy();
    expect(screen.getByTestId("birthday-ambient-celebration")).toBeTruthy();
    expect(screen.getAllByTestId("birthday-gold-glitter")).toHaveLength(42);
    expect(screen.queryByTestId("birthday-confetti")).toBeNull();
    await act(async () => {
      for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
    });
    expect(play).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BIRTHDAY_CELEBRATION_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Buka Kado Vanka" }));
    expect(screen.getByRole("button", { name: "Buka Surat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Buka hadiah/i })).toBeNull();
    expect(
      document
        .querySelector('[aria-label="Vanka Experience — ulang tahun Vanka"]')
        ?.parentElement?.hasAttribute("hidden"),
    ).toBe(false);
    expect(play).toHaveBeenCalled();
  });

  it("covers the page with the experience overlay", async () => {
    await renderAt(REVEAL);

    const overlay = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-label")).toContain("Vanka Experience");
    expect(screen.getByTestId("birthday-ambient-celebration").getAttribute("aria-hidden")).toBe("true");
    // The overlay starts at the gift box, where its ambient opening backdrop runs.
    expect(screen.getByRole("button", { name: /Buka hadiah/i })).toBeTruthy();
  });

  it("shows the ambient backdrop while opening the gift and letter", async () => {
    await renderAt(REVEAL);

    await act(async () => {
      screen.getByRole("button", { name: /Buka hadiah/i }).click();
      await new Promise((resolve) => window.setTimeout(resolve, 1750));
    });
    await act(async () => {
      screen.getByRole("button", { name: "Buka Surat" }).click();
    });
    await screen.findByRole("button", { name: "Buka surat ulang tahun dari Ayah" });
    expect(screen.getByTestId("birthday-ambient-celebration")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Buka surat ulang tahun dari Ayah" }).click();
      await new Promise((resolve) => window.setTimeout(resolve, 1150));
    });
    expect(screen.getByTestId("birthday-ambient-celebration")).toBeTruthy();
  });

  it("closes the overlay and keeps the card able to re-open it", async () => {
    await renderAt(REVEAL + 60_000);

    await act(async () => {
      screen.getByRole("button", { name: "Tutup ✕" }).click();
    });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();

    const card = cardFor("Birthday Experience") as HTMLButtonElement;
    expect(card.tagName).toBe("BUTTON");
    expect(card.textContent).toContain("Hari ini");
    expect(card.textContent).toContain("Putar Vanka Experience");

    await act(async () => {
      card.click();
    });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
  });

  it("does not link away while the overlay owns the experience", async () => {
    const container = await renderAt(REVEAL);

    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).not.toContain("/birthday-experience");
  });
});

describe("landing page — from the day after", () => {
  it("is the normal link again, with the original CTA", async () => {
    const container = await renderAt(DAY_AFTER);

    const birthday = linkByHref(container, "/birthday-experience");
    expect(birthday.textContent).toContain("Open the Birthday Experience");
    expect(birthday.textContent).not.toContain("Terbuka");
    expect(birthday.textContent).not.toContain("Hari ini");
    expect(birthday.querySelector("svg")).toBeNull();
  });

  it("no longer shows the overlay", async () => {
    await renderAt(DAY_AFTER);

    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  });

  it("renders all three chapter links", async () => {
    const container = await renderAt(DAY_AFTER);

    expect(
      Array.from(container.querySelectorAll("a")).map((link) => link.getAttribute("href")),
    ).toEqual(["/birthday-experience", "/memory-archive", "/arsip-ibu"]);
  });
});

describe("landing page — shared behaviour", () => {
  it("stays public: no PIN prompt, no inputs", async () => {
    const container = await renderAt(REVEAL - 60_000);

    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/masukkan pin|pin salah/i);
  });

  it("uses a balanced responsive grid", async () => {
    const container = await renderAt(DAY_AFTER);

    const grid = linkByHref(container, "/arsip-ibu").parentElement;
    expect(grid?.className).toContain("md:grid-cols-2");
    expect(grid?.className).toContain("lg:grid-cols-3");
  });

  it("gives each card a distinct, plain box-shadow glow that grows on hover/focus", async () => {
    const container = await renderAt(DAY_AFTER);

    const glows: Array<[string, string]> = [
      ["/birthday-experience", "rgba(139,92,246"],
      ["/memory-archive", "rgba(96,165,250"],
      ["/arsip-ibu", "rgba(233,198,124"],
    ];

    for (const [href, colour] of glows) {
      const className = linkByHref(container, href).className;
      expect(className).toContain(colour);
      expect(className).toContain("hover:shadow-");
      expect(className).toContain("focus-visible:shadow-");
      expect(className).toContain("motion-reduce:transition-none");
      expect(className).toContain("shadow-[");
    }
  });

  it("keeps a lock glyph on the gated card before the reveal", async () => {
    await renderAt(REVEAL - 60_000);

    const glyph = cardFor("Birthday Experience").querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });
});
