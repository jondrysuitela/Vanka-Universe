import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ArchiveGalleryView from "@/components/admin/archive/ArchiveGalleryView";
import type { ExperienceGalleryVideo, ExperiencePhoto } from "@/lib/archive/experience";

function photos(): ExperiencePhoto[] {
  return [
    {
      mediaId: "11111111-1111-4111-8111-111111111111",
      name: "dapur.jpg",
      title: "Ibu di dapur",
      description: "Pagi yang tenang, aroma kopi memenuhi rumah.",
      memoryDate: "2001-05-02",
    },
    {
      mediaId: "22222222-2222-4222-8222-222222222222",
      name: "kebun.jpg",
      title: "Di kebun belakang",
      description: "Ibu selalu bilang tanaman perlu disapa.",
      memoryDate: null,
    },
  ];
}

function videos(): ExperienceGalleryVideo[] {
  return [
    {
      mediaId: "33333333-3333-4333-8333-333333333333",
      name: "liburan.mp4",
      title: "Liburan",
      description: "Hari bersama keluarga.",
      memoryDate: "2021-02-03",
    },
  ];
}

describe("ArchiveGalleryView", () => {
  it("renders each photo's INDIVIDUAL title, description and optional date", () => {
    const html = renderToStaticMarkup(createElement(ArchiveGalleryView, { photos: photos() }));

    expect(html).toContain("Ibu di dapur");
    expect(html).toContain("Pagi yang tenang, aroma kopi memenuhi rumah.");
    expect(html).toContain("Di kebun belakang");
    expect(html).toContain("Ibu selalu bilang tanaman perlu disapa.");
    expect(html).toContain('dateTime="2001-05-02"');
    // References media by id, never a fabricated URL/path.
    expect(html).toContain('src="/api/media/11111111-1111-4111-8111-111111111111"');
    // Detail view is closed initially (no dialog rendered).
    expect(html).not.toContain('aria-modal="true"');
  });

  it("renders playable video memories with their own metadata", () => {
    const html = renderToStaticMarkup(
      createElement(ArchiveGalleryView, { photos: [], videos: videos() }),
    );
    expect(html).toContain("<video");
    expect(html).toContain("controls");
    expect(html).toContain("Liburan");
    expect(html).toContain("Hari bersama keluarga.");
    expect(html).toContain('src="/api/media/33333333-3333-4333-8333-333333333333"');
  });

  it("shows an honest empty state and no sample photos", () => {
    const html = renderToStaticMarkup(createElement(ArchiveGalleryView, { photos: [] }));
    expect(html).toContain("Belum ada media di galeri arsip.");
    expect(html).not.toContain("<img");
  });
});
