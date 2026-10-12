import { describe, expect, it, vi } from "vitest";

import {
  galleryUrl,
  loadBirthdayGallery,
  type BirthdayGalleryData,
} from "@/lib/birthday/gallery/client-sync";

const DATA: BirthdayGalleryData = {
  year: 2026,
  age: 1,
  revealed: true,
  revealAt: "2026-10-26T15:00:00.000Z",
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      kind: "image",
      mime: "image/png",
      name: "vanka.png",
      title: "Senyum pertama",
      description: null,
      takenAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
    },
  ],
};

function okBody(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("galleryUrl", () => {
  it("builds the public and preview URLs", () => {
    expect(galleryUrl(false)).toBe("/api/birthday/gallery");
    expect(galleryUrl(true)).toBe("/api/birthday/gallery?preview=1");
    expect(galleryUrl(false, 2027)).toBe("/api/birthday/gallery?year=2027");
    expect(galleryUrl(true, 2027)).toBe("/api/birthday/gallery?preview=1&year=2027");
  });
});

describe("loadBirthdayGallery", () => {
  it("returns the parsed gallery on 200", async () => {
    const fetchLike = vi.fn().mockResolvedValue(okBody({ data: DATA }));
    const result = await loadBirthdayGallery(fetchLike, false);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.data.items).toHaveLength(1);
    expect(fetchLike).toHaveBeenCalledWith("/api/birthday/gallery", {
      headers: { accept: "application/json" },
    });
  });

  it("maps 403 to locked (the birthday has not happened yet)", async () => {
    const fetchLike = vi.fn().mockResolvedValue(
      okBody({ error: { code: "GALLERY_LOCKED", message: "" } }, 403),
    );
    expect((await loadBirthdayGallery(fetchLike, false)).status).toBe("locked");
  });

  it("maps 401/403 on preview to unauthorized", async () => {
    const fetchLike = vi.fn().mockResolvedValue(
      okBody({ error: { code: "FORBIDDEN", message: "" } }, 403),
    );
    expect((await loadBirthdayGallery(fetchLike, true)).status).toBe("unauthorized");
  });

  it("maps a server error to unavailable, never an empty gallery", async () => {
    const fetchLike = vi.fn().mockResolvedValue(new Response("boom", { status: 503 }));
    const result = await loadBirthdayGallery(fetchLike, false);
    expect(result.status).toBe("unavailable");
  });

  it("maps a network rejection to unavailable", async () => {
    const fetchLike = vi.fn().mockRejectedValue(new TypeError("network"));
    expect((await loadBirthdayGallery(fetchLike, false)).status).toBe("unavailable");
  });

  it("maps a valid status but malformed body to unavailable", async () => {
    const fetchLike = vi.fn().mockResolvedValue(okBody({ data: { year: 2026 } }));
    expect((await loadBirthdayGallery(fetchLike, false)).status).toBe("unavailable");
  });
});