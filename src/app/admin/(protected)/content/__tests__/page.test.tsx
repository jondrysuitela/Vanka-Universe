// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import AdminContentPage from "@/app/admin/(protected)/content/page";
import { ToastProvider } from "@/components/admin/ui/ToastProvider";

const savedMedia = [
  {
    id: "jpeg-photo",
    name: "family.jpg",
    mime: "image/jpeg",
    kind: "image",
    size: 1024,
    ownerId: "admin",
    ownerLabel: "Admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Family",
    description: null,
    takenAt: null,
  },
  {
    id: "animated-gif",
    name: "memory.gif",
    mime: "image/gif",
    kind: "image",
    size: 1024,
    ownerId: "admin",
    ownerLabel: "Admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: null,
    description: null,
    takenAt: null,
  },
  {
    id: "video",
    name: "memory.mp4",
    mime: "video/mp4",
    kind: "video",
    size: 1024,
    ownerId: "admin",
    ownerLabel: "Admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: null,
    description: null,
    takenAt: null,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin content editor image crop", () => {
  it("offers crop for supported existing photos, not animated GIFs or videos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: savedMedia }),
      }),
    );

    render(
      <ToastProvider>
        <AdminContentPage />
      </ToastProvider>,
    );

    expect(await screen.findByRole("button", { name: "Crop & ganti" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Crop & ganti" })).toHaveLength(1);
    expect(screen.getByText("memory.gif")).toBeTruthy();
    expect(screen.getByText("memory.mp4")).toBeTruthy();
  });

  it("warns that cropping replaces the original for every existing use", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/media") {
        return Promise.resolve({ ok: true, json: async () => ({ data: [savedMedia[0]] }) });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => new Blob(["photo"], { type: "image/jpeg" }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const NativeURL = URL;
    vi.stubGlobal(
      "URL",
      class MockURL extends NativeURL {
        static createObjectURL = vi.fn(() => "blob:photo");
        static revokeObjectURL = vi.fn();
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));

    render(
      <ToastProvider>
        <AdminContentPage />
      </ToastProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop & ganti" }));
    expect(await screen.findByRole("dialog", { name: "Sesuaikan foto scrapbook" })).toBeTruthy();
    expect(screen.getByText(/Semua galeri dan thumbnail yang menggunakannya ikut berubah/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media/jpeg-photo"));
  });
});
