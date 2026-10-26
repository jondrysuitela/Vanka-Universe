"use client";

import { useEffect, useState } from "react";

import type { ExperienceGalleryVideo, ExperiencePhoto } from "@/lib/archive/experience";

/**
 * Presentational Polaroid gallery for the private-archive experience (4G.39C).
 *
 * Pure view over already-resolved photos: no fetching, no `localStorage`. Shows
 * each photo's INDIVIDUAL title/description/optional date, and a larger detail
 * view (lightbox) with keyboard support (Escape closes).
 */

export default function ArchiveGalleryView({
  photos,
  videos = [],
}: {
  photos: ExperiencePhoto[];
  videos?: ExperienceGalleryVideo[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex]);

  if (photos.length === 0 && videos.length === 0) {
    return (
      <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-[#fdf3d8]/70">
        Belum ada media di galeri arsip.
      </p>
    );
  }

  const open = openIndex === null ? null : photos[openIndex];

  return (
    <section aria-label="Galeri kenangan" className="space-y-8">
      {videos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-center font-display text-xl text-[#f6e3b2]">Video Kenangan</h2>
          <ol className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {videos.map((video) => (
              <li key={video.mediaId}>
                <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1226]/80 shadow-xl">
                  <video
                    src={`/api/media/${video.mediaId}`}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={video.title || video.name}
                    className="aspect-video w-full bg-black object-contain"
                  />
                  {(video.title || video.description || video.memoryDate) && (
                    <div className="space-y-1 px-4 py-3 text-center">
                      {video.title && (
                        <h3 className="font-display text-base text-[#f6e3b2]">{video.title}</h3>
                      )}
                      {video.description && (
                        <p className="text-sm text-white/75">{video.description}</p>
                      )}
                      {video.memoryDate && (
                        <p className="text-xs text-white/55">{video.memoryDate}</p>
                      )}
                    </div>
                  )}
                </article>
              </li>
            ))}
          </ol>
        </div>
      )}
      {photos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-center font-display text-xl text-[#f6e3b2]">Foto Kenangan</h2>
          <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo, index) => (
              <li key={photo.mediaId}>
                <article className="rounded-[16px] bg-[#fdf6e3] p-3 pb-6 shadow-[0_22px_45px_-22px_rgba(0,0,0,0.85)] ring-1 ring-black/5 motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 sm:p-4 sm:pb-8">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(index)}
                    aria-label={`Buka detail foto: ${photo.title || photo.name}`}
                    className="block w-full rounded-[8px] overflow-hidden bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${photo.mediaId}`}
                      alt={photo.title || photo.name}
                      className="aspect-square h-auto w-full object-cover"
                      loading="lazy"
                    />
                  </button>

                  <div className="mt-4 space-y-1.5 px-1 text-center">
                    <h3 className="font-display text-base text-[#4a3d24]">
                      {photo.title || "Tanpa judul"}
                    </h3>
                    {photo.description && (
                      <p className="text-sm leading-relaxed text-[#6b5a3c]">{photo.description}</p>
                    )}
                    {photo.memoryDate && (
                      <time
                        dateTime={photo.memoryDate}
                        className="block text-xs tracking-wide text-[#8a7853]"
                      >
                        {photo.memoryDate}
                      </time>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Tutup detail foto"
            onClick={() => setOpenIndex(null)}
            className="absolute inset-0 bg-black/75"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={open.title || open.name}
            className="relative max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#0b1226]/95 p-4 backdrop-blur-xl"
          >
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpenIndex(null)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#fdf3d8]/90 hover:bg-white/5"
              >
                Tutup
              </button>
            </div>
            <div className="mt-2 overflow-hidden rounded-xl bg-black/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/media/${open.mediaId}`}
                alt={open.title || open.name}
                className="mx-auto max-h-[70vh] w-auto object-contain"
              />
            </div>
            <div className="mt-4 space-y-1 text-center">
              <h3 className="font-display text-xl text-[#fdf3d8]">{open.title || "Tanpa judul"}</h3>
              {open.description && (
                <p className="text-sm leading-relaxed text-[#fdf3d8]/80">{open.description}</p>
              )}
              {open.memoryDate && (
                <time dateTime={open.memoryDate} className="block text-xs tracking-wide text-[#f6d77a]">
                  {open.memoryDate}
                </time>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
