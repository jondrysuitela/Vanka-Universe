"use client";

import {
  experienceMediaUrl,
  formatMemoryDate,
  type VisitorExperiencePhoto,
  type VisitorExperienceVideo,
} from "@/lib/archive/visitor";

/**
 * Read-only Polaroid gallery for visitors (Tahap VU-ARCHIVE-ACCESS-4A).
 *
 * Pure presentational view over already-resolved photos. Images stream ONLY from
 * the authenticated visitor proxy `experienceMediaUrl` — never a direct storage
 * key, endpoint, or signed URL. Each card shows the photo's own title,
 * description, and date when present; nothing is invented.
 */
export default function ArchivePhotoGallery({
  photos,
  videos = [],
}: {
  photos: VisitorExperiencePhoto[];
  videos?: VisitorExperienceVideo[];
}) {
  if (photos.length === 0 && videos.length === 0) {
    return (
      <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/70">
        Belum ada kenangan yang tersimpan di arsip ini.
      </p>
    );
  }

  return (
    <section aria-label="Galeri kenangan" className="space-y-10">
      {videos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-center font-display text-xl text-[#f6e3b2]">Video Kenangan</h2>
          <ol className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {videos.map((video) => {
              const date = formatMemoryDate(video.memoryDate);
              return (
                <li key={video.mediaId}>
                  <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1226]/80 shadow-xl">
                    <video
                      src={experienceMediaUrl(video.mediaId)}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={video.title || video.description || "Video kenangan"}
                      className="aspect-video w-full bg-black object-contain"
                    />
                    {(video.title || video.description || date) && (
                      <figcaption className="space-y-1.5 px-4 py-3 text-center">
                        {video.title && <h3 className="font-display text-base text-[#f6e3b2]">{video.title}</h3>}
                        {video.description && <p className="text-sm leading-relaxed text-white/75">{video.description}</p>}
                        {date && <time dateTime={video.memoryDate ?? undefined} className="block text-xs text-white/55">{date}</time>}
                      </figcaption>
                    )}
                  </figure>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {photos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-center font-display text-xl text-[#f6e3b2]">Foto Kenangan</h2>
          <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => {
              const date = formatMemoryDate(photo.memoryDate);
              return (
                <li key={photo.mediaId}>
                  <figure className="flex h-full flex-col rounded-[16px] bg-[#fdf6e3] p-3 pb-5 shadow-[0_22px_45px_-22px_rgba(0,0,0,0.85)] ring-1 ring-black/5 motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 sm:p-4 sm:pb-6">
                    <div className="overflow-hidden rounded-[8px] bg-black/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={experienceMediaUrl(photo.mediaId)}
                        alt={photo.title || photo.description || "Foto kenangan"}
                        loading="lazy"
                        className="aspect-square h-auto w-full object-cover"
                      />
                    </div>

                    {(photo.title || photo.description || date) && (
                      <figcaption className="mt-4 space-y-1.5 px-1 text-center">
                        {photo.title && (
                          <h3 className="font-display text-base text-[#4a3d24]">{photo.title}</h3>
                        )}
                        {photo.description && (
                          <p className="text-sm leading-relaxed text-[#6b5a3c]">
                            {photo.description}
                          </p>
                        )}
                        {date && (
                          <time
                            dateTime={photo.memoryDate ?? undefined}
                            className="block text-xs tracking-wide text-[#8a7853]"
                          >
                            {date}
                          </time>
                        )}
                      </figcaption>
                    )}
                  </figure>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
