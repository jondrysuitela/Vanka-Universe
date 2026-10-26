// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ArchiveVisitorExperience from "@/components/archive/ArchiveVisitorExperience";
import { ARCHIVE_VISITOR_MESSAGES, experienceMediaUrl } from "@/lib/archive/visitor";

import { installFetchMock } from "./fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const INTRO = "33333333-3333-4333-8333-333333333333";
const IMG = "11111111-1111-4111-8111-111111111111";
const VIDEO = "44444444-4444-4444-8444-444444444444";

const FULL = {
  title: "Tentang Ibumu",
  narrative: "Baris satu.\n\nBaris dua.",
  musicEnabled: true,
  introMediaId: INTRO,
  photos: [
    { mediaId: IMG, title: "Pantai", description: "Hari itu", memoryDate: "2020-01-01", position: 0 },
  ],
  videos: [],
};

const EMPTY = {
  title: "",
  narrative: "",
  musicEnabled: false,
  introMediaId: null,
  photos: [],
  videos: [],
};

function handlerFor(status: number, data?: unknown) {
  return (url: string) => {
    if (url === "/api/archive/access/logout") return { status: 200, body: { data: { unlocked: false } } };
    if (url.startsWith("/api/archive/experience/media/")) return { status: 404 };
    return status < 300
      ? { status, body: { data } }
      : { status, body: { error: { code: "ERR" } } };
  };
}

describe("ArchiveVisitorExperience", () => {
  it("renders the real title, narrative, intro, and gallery — no internals leaked", async () => {
    installFetchMock(handlerFor(200, FULL));
    const onSessionEnded = vi.fn();
    const { container } = render(<ArchiveVisitorExperience onSessionEnded={onSessionEnded} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Tentang Ibumu" })).toBeTruthy();
    expect(screen.getByText("Baris satu.")).toBeTruthy();
    expect(screen.getByText("Baris dua.")).toBeTruthy();

    const video = screen.getByLabelText("Video pembuka arsip") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(experienceMediaUrl(INTRO));

    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(experienceMediaUrl(IMG));
    expect(screen.getByText("Pantai")).toBeTruthy();
    expect(screen.getByText("Hari itu")).toBeTruthy();
    expect(screen.getByText("1 Januari 2020")).toBeTruthy();

    const html = container.innerHTML;
    expect(html).not.toContain("storageKey");
    expect(html).not.toContain("presign");
    expect(html).not.toContain("access_token");
  });

  it("does not show unsupported music controls or diagnostics", async () => {
    installFetchMock(handlerFor(200, FULL));
    const { container } = render(<ArchiveVisitorExperience onSessionEnded={vi.fn()} />);

    await screen.findByRole("heading", { level: 1, name: "Tentang Ibumu" });
    expect(container.textContent).not.toContain("Musik");
    expect(container.querySelectorAll("audio")).toHaveLength(0);
    // The intro is the only video until gallery media is configured.
    expect(container.querySelectorAll("video")).toHaveLength(1);
  });

  it("renders gallery videos with browser playback controls through the visitor proxy", async () => {
    installFetchMock(
      handlerFor(200, {
        ...FULL,
        videos: [
          {
            mediaId: VIDEO,
            title: "Perayaan keluarga",
            description: "Hari yang hangat",
            memoryDate: null,
            position: 0,
          },
        ],
      }),
    );
    const { container } = render(<ArchiveVisitorExperience onSessionEnded={vi.fn()} />);

    const video = (await screen.findByLabelText("Perayaan keluarga")) as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe(experienceMediaUrl(VIDEO));
    expect(video.hasAttribute("controls")).toBe(true);
    expect(container.querySelectorAll("video")).toHaveLength(2);
    expect(screen.getByText("Hari yang hangat")).toBeTruthy();
  });

  it("renders an honest empty state when there is no content", async () => {
    installFetchMock(handlerFor(200, EMPTY));
    const { container } = render(<ArchiveVisitorExperience onSessionEnded={vi.fn()} />);

    expect(await screen.findByText(ARCHIVE_VISITOR_MESSAGES.empty)).toBeTruthy();
    expect(screen.queryByLabelText("Video pembuka arsip")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("shows 'archive not ready' on 503 WITHOUT opening private data", async () => {
    installFetchMock(handlerFor(503));
    const onSessionEnded = vi.fn();
    const { container } = render(<ArchiveVisitorExperience onSessionEnded={onSessionEnded} />);

    expect(await screen.findByText("Arsip belum siap")).toBeTruthy();
    expect(screen.getByText(ARCHIVE_VISITOR_MESSAGES.notReady)).toBeTruthy();
    expect(onSessionEnded).not.toHaveBeenCalled();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("returns to the PIN gate on a 401 (session ended)", async () => {
    installFetchMock(handlerFor(401));
    const onSessionEnded = vi.fn();
    render(<ArchiveVisitorExperience onSessionEnded={onSessionEnded} />);

    await waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("re-locks: calls logout then notifies the parent", async () => {
    const { calls } = installFetchMock(handlerFor(200, FULL));
    const onSessionEnded = vi.fn();
    render(<ArchiveVisitorExperience onSessionEnded={onSessionEnded} />);

    await screen.findByRole("heading", { level: 1, name: "Tentang Ibumu" });
    fireEvent.click(screen.getByRole("button", { name: /Kunci ulang/i }));

    await waitFor(() => expect(onSessionEnded).toHaveBeenCalledTimes(1));
    const logout = calls.find((call) => call.url === "/api/archive/access/logout");
    expect(logout?.init?.method).toBe("POST");
    expect((logout?.init?.headers as Record<string, string>)["x-vanka-request"]).toBe("1");
  });

  it("degrades honestly when the intro video fails, keeping the gallery", async () => {
    installFetchMock(handlerFor(200, FULL));
    render(<ArchiveVisitorExperience onSessionEnded={vi.fn()} />);

    const video = (await screen.findByLabelText("Video pembuka arsip")) as HTMLVideoElement;
    fireEvent(video, new Event("error"));

    expect(await screen.findByText(ARCHIVE_VISITOR_MESSAGES.introFailed)).toBeTruthy();
    expect(screen.getByText("Pantai")).toBeTruthy();
  });
});
