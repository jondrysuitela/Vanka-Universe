// @vitest-environment jsdom
import "../../__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import MemoryArchivePage from "@/app/memory-archive/page";

/**
 * Memory Archive: one chapter per birthday, newest first, each in its own
 * theme — and only once that birthday has actually happened.
 */

const REVEAL_2026 = new Date("2026-10-26T15:00:00.000Z").getTime();
const REVEAL_2027 = new Date("2027-10-26T15:00:00.000Z").getTime();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderAt(nowMs: number): Promise<HTMLElement> {
  vi.setSystemTime(new Date(nowMs));
  const { container } = render(<MemoryArchivePage />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  return container;
}

describe("Memory Archive", () => {
  it("says honestly that no birthday has opened yet", async () => {
    const container = await renderAt(REVEAL_2026 - 60_000);

    expect(container.textContent).toContain("Belum ada ulang tahun yang tayang");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });

  it("lists the first edition once its birthday has happened", async () => {
    const container = await renderAt(REVEAL_2026 + 24 * 60 * 60 * 1000);

    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(1);
    expect(articles[0].textContent).toContain("Usia 1 · 2026");
    expect(articles[0].textContent).toContain("Vanka's First Universe");
    expect(articles[0].textContent).toContain("27 Oktober 2026");
  });

  it("links each built edition to its replay URL", async () => {
    const container = await renderAt(REVEAL_2026 + 24 * 60 * 60 * 1000);

    const link = Array.from(container.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("Putar Ulang Pengalaman"),
    );
    expect(link?.getAttribute("href")).toBe("/birthday-experience?edition=1");
  });

  it("grows year by year, newest first", async () => {
    const container = await renderAt(REVEAL_2027);

    const articles = Array.from(container.querySelectorAll("article"));
    expect(articles).toHaveLength(2);
    expect(articles[0].textContent).toContain("Usia 2 · 2027");
    expect(articles[1].textContent).toContain("Usia 1 · 2026");
  });

  it("dresses each edition in its own theme palette", async () => {
    const container = await renderAt(REVEAL_2027);
    const [newest, older] = Array.from(container.querySelectorAll("article"));

    // Age 1 is the cosmic blue/gold theme; age 2 the garden green/pink one.
    expect(older.getAttribute("style")).toContain("rgb(10, 19, 48)"); // #0a1330
    expect(newest.getAttribute("style")).toContain("rgb(15, 38, 24)"); // #0f2618
    expect(newest.getAttribute("style")).not.toBe(older.getAttribute("style"));
  });

  it("marks the birthday day", async () => {
    const container = await renderAt(REVEAL_2026);

    expect(container.textContent).toContain("Hari ini");
  });

  it("never lists a year whose birthday has not happened", async () => {
    const container = await renderAt(REVEAL_2027 - 60_000);

    expect(container.textContent).not.toContain("Usia 2 · 2027");
    expect(container.textContent).toContain("Usia 1 · 2026");
  });
});
