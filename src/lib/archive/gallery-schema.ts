import { z } from "zod";

import { isIsoDate } from "@/lib/media/schema";

/**
 * Validation contract for the private-archive gallery API (Tahap 4G.39).
 *
 * SHAPE only. The gallery is part of the ALWAYS-private archive: there is no
 * client-supplied `privacy`, `status`, `slug`, `id`, or ordering key the client
 * can trust — the server derives `position` from array order. `strictObject`
 * rejects unknown keys, so browser-local paths/URLs (`src`, `path`) can never be
 * smuggled in either: the gallery references media ONLY by validated media id.
 *
 * The route additionally validates each `mediaId` against the real media store
 * (must exist, and match the gallery role). This schema checks shape,
 * uniqueness, and that the intro is not reused in the gallery.
 */

/** Hard cap so a single save can never submit an unbounded gallery. */
export const MAX_GALLERY_ITEMS = 200;

const isoDate = z
  .string()
  .refine(isIsoDate, { message: "Format tanggal harus YYYY-MM-DD yang valid." });

const galleryItemSchema = z.strictObject({
  mediaId: z.uuid(),
  title: z.string().trim().max(255),
  description: z.string().max(5000),
  memoryDate: isoDate.nullable().optional().transform((value) => value ?? null),
});

export const saveGallerySchema = z
  .strictObject({
    /**
     * Intro video reference — a media UUID, or null when none is chosen (the
     * experience then falls back straight to the gallery). Must be a video;
     * enforced against the real media store in the route.
     */
    introMediaId: z.uuid().nullable().optional().transform((value) => value ?? null),
    photos: z.array(galleryItemSchema).max(MAX_GALLERY_ITEMS),
    videos: z.array(galleryItemSchema).max(MAX_GALLERY_ITEMS).default([]),
  })
  .refine(
    (value) => value.photos.length + value.videos.length <= MAX_GALLERY_ITEMS,
    {
      message: `Galeri maksimal berisi ${MAX_GALLERY_ITEMS} media.`,
      path: ["videos"],
    },
  )
  .refine(
    (value) => {
      const mediaIds = [
        ...value.photos.map((item) => item.mediaId),
        ...value.videos.map((item) => item.mediaId),
      ];
      return new Set(mediaIds).size === mediaIds.length;
    },
    { message: "Media duplikat dalam galeri.", path: ["photos"] },
  )
  .refine(
    (value) =>
      value.introMediaId === null ||
      ![...value.photos, ...value.videos].some((item) => item.mediaId === value.introMediaId),
    {
      message: "Video pembuka tidak boleh dipakai sebagai item galeri.",
      path: ["introMediaId"],
    },
  );

export type GalleryItemInput = z.output<typeof galleryItemSchema>;
export type SaveGalleryInput = z.output<typeof saveGallerySchema>;
