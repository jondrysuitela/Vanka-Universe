import { describe, expect, it, vi } from "vitest";

import { letterUrl, loadBirthdayLetter } from "@/lib/birthday/letters/public-sync";

const DATA = {
  year: 2026,
  age: 1,
  revealed: true,
  revealAt: "2026-10-26T15:00:00.000Z",
  letter: {
    title: "Selamat ulang tahun",
    displayDate: "27 Oktober 2026",
    fullText: "Isi surat.",
    sections: [{ id: "s1", heading: "Pembuka", body: "Halo" }],
    thumbnail: { src: "/api/birthday/gallery/media/11111111-1111-4111-8111-111111111111", alt: "Vanka" },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("letterUrl", () => {
  it("omits the year by default and includes it when given", () => {
    expect(letterUrl()).toBe("/api/birthday/letter");
    expect(letterUrl(2027)).toBe("/api/birthday/letter?year=2027");
  });
});

describe("loadBirthdayLetter", () => {
  it("returns ok with the letter", async () => {
    const fetcher = vi.fn(async () => json({ data: DATA }));
    const result = await loadBirthdayLetter(fetcher);
    expect(result).toEqual({ status: "ok", data: DATA });
    expect(fetcher).toHaveBeenCalledWith("/api/birthday/letter", {
      headers: { accept: "application/json" },
    });
  });

  it("accepts a null letter (edition exists, nothing saved yet)", async () => {
    const fetcher = vi.fn(async () => json({ data: { ...DATA, letter: null } }));
    const result = await loadBirthdayLetter(fetcher, 2026);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.data.letter).toBeNull();
    expect(fetcher).toHaveBeenCalledWith("/api/birthday/letter?year=2026", expect.anything());
  });

  it("maps 403 to locked", async () => {
    const fetcher = vi.fn(async () => json({ error: { code: "LETTER_LOCKED" } }, 403));
    expect(await loadBirthdayLetter(fetcher)).toEqual({ status: "locked" });
  });

  it("maps a server error and a network failure to unavailable", async () => {
    const failing = vi.fn(async () => json({ error: { code: "INTERNAL_ERROR" } }, 500));
    expect(await loadBirthdayLetter(failing)).toEqual({ status: "unavailable" });

    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await loadBirthdayLetter(offline)).toEqual({ status: "unavailable" });
  });

  it("never fabricates: an unshaped payload is unavailable", async () => {
    const fetcher = vi.fn(async () => json({ data: { year: 2026 } }));
    expect(await loadBirthdayLetter(fetcher)).toEqual({ status: "unavailable" });
  });
});
