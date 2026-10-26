// @vitest-environment jsdom
import "../../../app/__tests__/jsdom-stubs";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("framer-motion", () => ({ useReducedMotion: () => false }));

import ExperienceMusic from "@/components/birthday/ExperienceMusic";

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => ({ data }),
  } as Response;
}

describe("ExperienceMusic", () => {
  it("plays an unpublished edition candidate in admin preview through the admin media route", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        music: [{ year: 2026, mediaId: MEDIA_ID, volume: 0.4 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <ExperienceMusic age={1} editionYear={2026} started adminPreview />,
    );

    await waitFor(() => {
      expect(container.querySelector("audio")?.getAttribute("src")).toBe(`/api/media/${MEDIA_ID}`);
      expect(play).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/birthday/music",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("keeps public playback on the published, date-gated music routes", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ music: { mediaId: MEDIA_ID, volume: 0.7 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<ExperienceMusic age={1} editionYear={2026} started />);

    await waitFor(() => {
      expect(container.querySelector("audio")?.getAttribute("src")).toBe(
        `/api/birthday/music/media/${MEDIA_ID}`,
      );
      expect(play).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/birthday/music?year=2026",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("offers a user-gesture retry when the browser blocks automatic playback", async () => {
    const play = vi
      .fn()
      .mockRejectedValueOnce(new Error("playback blocked"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          music: [{ year: 2026, mediaId: MEDIA_ID, volume: null }],
        }),
      ),
    );

    render(<ExperienceMusic age={1} editionYear={2026} started adminPreview />);

    const retry = await screen.findByRole("button", { name: "Putar musik" });
    fireEvent.click(retry);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });
});
