import { describe, expect, it } from "vitest";

import { buildVisitorExperience } from "@/lib/archive/access/experience";
import type { PrivateGallery } from "@/lib/archive/gallery-repository";
import type { PrivateArchiveRow } from "@/lib/archive/repository";

const archiveRow: PrivateArchiveRow = {
  id: "a1",
  slug: "tentang-ibumu",
  title: "Tentang Ibumu",
  narrative: "Cerita panjang.",
  music_enabled: true,
  music_media_id: null,
  status: "draft",
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const gallery: PrivateGallery = {
  introMediaId: "vid-1",
  photos: [
    { mediaId: "img-1", title: "A", description: "Cerita", memoryDate: "2020-01-01", position: 0 },
  ],
  videos: [
    { mediaId: "video-1", title: "B", description: "Kenangan", memoryDate: null, position: 0 },
  ],
};

describe("buildVisitorExperience", () => {
  it("maps the real archive row + gallery and invents nothing", () => {
    const view = buildVisitorExperience(archiveRow, gallery);
    expect(view).toEqual({
      title: "Tentang Ibumu",
      narrative: "Cerita panjang.",
      musicEnabled: true,
      introMediaId: "vid-1",
      photos: [
        { mediaId: "img-1", title: "A", description: "Cerita", memoryDate: "2020-01-01", position: 0 },
      ],
      videos: [
        { mediaId: "video-1", title: "B", description: "Kenangan", memoryDate: null, position: 0 },
      ],
    });
    // No storage internals or audio URL are ever produced.
    expect(Object.keys(view)).not.toContain("musicMediaId");
    expect(JSON.stringify(view)).not.toContain("url");
  });

  it("returns an honest empty view when the archive row is absent", () => {
    const view = buildVisitorExperience(null, { introMediaId: null, photos: [], videos: [] });
    expect(view).toEqual({
      title: "",
      narrative: "",
      musicEnabled: false,
      introMediaId: null,
      photos: [],
      videos: [],
    });
  });
});
