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
 * (must exist, and be `image` for a photo / `video` for the intro). This schema
 * checks shape, uniqueness, and that the intro is not reused as a photo.
 */

/** Hard cap so a single save can never submit an unbounded gallery. */
export const MAX_GALLERY_PHOTOS = 200;

const isoDate = z
  .string()
  .refine(isIsoDate, { message: "Format tanggal harus YYYY-MM-DD yang valid." });

export const galleryPhotoSchema = z.strictObject({
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
    photos: z.array(galleryPhotoSchema).max(MAX_GALLERY_PHOTOS),
  })
  .refine(
    (value) => new Set(value.photos.map((photo) => photo.mediaId)).size === value.photos.length,
    { message: "Media foto duplikat dalam galeri.", path: ["photos"] },
  )
  .refine(
    (value) =>
      value.introMediaId === null ||
      !value.photos.some((photo) => photo.mediaId === value.introMediaId),
    {
      message: "Media tidak boleh menjadi video pembuka dan foto sekaligus.",
      path: ["introMediaId"],
    },
  );

export type GalleryPhotoInput = z.output<typeof galleryPhotoSchema>;
export type SaveGalleryInput = z.output<typeof saveGallerySchema>;
