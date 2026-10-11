// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ArsipIbuPage from "@/app/arsip-ibu/page";
import { ARCHIVE_VISITOR_MESSAGES } from "@/lib/archive/visitor";

import { installFetchMock } from "@/components/archive/__tests__/fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FULL = {
  title: "Tentang Ibumu",
  narrative: "Cerita.",
  musicEnabled: false,
  introMediaId: null,
  photos: [],
};

describe("/arsip-ibu page", () => {
  it("shows the PIN gate when the archive is still locked", async () => {
    installFetchMock((url) =>
      url === "/api/archive/access"
        ? { status: 200, body: { data: { unlocked: false } } }
        : { status: 404 },
    );
    render(<ArsipIbuPage />);

    expect(await screen.findByRole("group", { name: "PIN" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Arsip Ibu");
  });

  it("opens the experience directly when the session is already valid", async () => {
    installFetchMock((url) => {
      if (url === "/api/archive/access") return { status: 200, body: { data: { unlocked: true } } };
      if (url === "/api/archive/experience") return { status: 200, body: { data: FULL } };
      return { status: 404 };
    });
    render(<ArsipIbuPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Tentang Ibumu" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "PIN" })).toBeNull();
  });

  it("fails closed to the PIN gate when the access check errors", async () => {
    installFetchMock(() => {
      throw new Error("offline");
    });
    render(<ArsipIbuPage />);

    expect(await screen.findByRole("group", { name: "PIN" })).toBeTruthy();
  });

  it("falls back to the PIN gate with a notice when the session expires mid-experience", async () => {
    installFetchMock((url) => {
      if (url === "/api/archive/access") return { status: 200, body: { data: { unlocked: true } } };
      if (url === "/api/archive/experience") return { status: 401 };
      return { status: 404 };
    });
    render(<ArsipIbuPage />);

    expect(await screen.findByRole("group", { name: "PIN" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(ARCHIVE_VISITOR_MESSAGES.sessionEnded);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Arsip Ibu");
  });
});
