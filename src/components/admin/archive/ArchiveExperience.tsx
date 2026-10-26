"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import ArchiveGalleryView from "@/components/admin/archive/ArchiveGalleryView";
import {
  type Experience,
  type ExperiencePhase,
  experienceNote,
  initialPhase,
  loadExperience,
  nextPhase,
} from "@/lib/archive/experience";

/**
 * Arsip Ibu — protected viewing experience (Tahap 4G.39C).
 *
 * Flow: intro video → transition → private video/photo gallery. Rendered ONLY inside the
 * admin-protected area (`/admin/archive/experience`).
 *
 * HONEST STATE:
 *  - Loads the real server gallery + media library. No fake data, no localStorage.
 *  - The move to the gallery is driven by the video's real `ended` event, the
 *    explicit "Lewati video" action, or a load error — never a fixed timer.
 *  - A 503 (migration not applied) is shown as "not activated", never as an empty
 *    saved gallery.
 *  - Reduced motion is respected via `motion-safe`/`motion-reduce` classes.
 */

type LoadState =
  | { status: "loading" }
  | { status: "ok"; experience: Experience }
  | { status: "not_migrated" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

const INTRO_LINE =
  "Vanka, di sini tersimpan cerita dan kenangan tentang Ibu. Setiap foto punya kisahnya sendiri.";

export default function ArchiveExperience() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [phase, setPhase] = useState<ExperiencePhase>("gallery");
  const [needsPlay, setNeedsPlay] = useState(false);
  const [muted, setMuted] = useState(true);
  const [introFailed, setIntroFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Initial load only. No localStorage, no fake data, no silent overwrite.
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await loadExperience(fetch);
      if (!active) return;
      if (result.status === "ok") {
        setPhase(initialPhase(result.experience));
        setLoadState({ status: "ok", experience: result.experience });
      } else {
        setLoadState({ status: result.status });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const experience = loadState.status === "ok" ? loadState.experience : null;
  const intro = experience?.intro ?? null;

  // Try autoplay (muted). If the browser refuses, reveal an explicit Play button.
  useEffect(() => {
    if (phase !== "intro" || !intro) return;
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => setNeedsPlay(true));
    }
  }, [phase, intro]);

  function goToGallery() {
    setPhase((current) => nextPhase(current, "skip"));
  }

  function handlePlay() {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => setNeedsPlay(false))
      .catch(() => setNeedsPlay(true));
  }

  function handleSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video
      .play()
      .then(() => setNeedsPlay(false))
      .catch(() => setNeedsPlay(true));
  }

  function toggleMute() {
    const video = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (video) video.muted = next;
  }

  /* ---------------------------------------------------------------- render */

  if (loadState.status === "loading") {
    return (
      <p
        role="status"
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-[#fdf3d8]/70"
      >
        Memuat arsip…
      </p>
    );
  }

  if (loadState.status !== "ok") {
    const note = experienceNote(loadState.status);
    return (
      <div
        role="status"
        className="rounded-2xl border border-white/15 bg-white/5 px-5 py-6 space-y-2"
      >
        <h2 className="font-display text-lg text-[#fdf3d8]">{note.title}</h2>
        <p className="text-sm text-[#fdf3d8]/75">{note.message}</p>
        <p className="pt-2 text-xs text-[#fdf3d8]/55">
          <Link href="/admin/archive" className="underline hover:text-[#f6d77a]">
            Kembali ke pengelolaan arsip
          </Link>
        </p>
      </div>
    );
  }

  // phase === "intro" and a video exists, not (yet) failed.
  if (phase === "intro" && intro && !introFailed) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 p-4 backdrop-blur-xl">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              src={`/api/media/${intro.mediaId}`}
              controls
              playsInline
              preload="metadata"
              muted={muted}
              aria-label={`Video pembuka: ${intro.name}`}
              className="mx-auto max-h-[70vh] w-full bg-black object-contain"
              onEnded={() => setPhase((current) => nextPhase(current, "ended"))}
              onError={() => setIntroFailed(true)}
            />

            {needsPlay && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55">
                <button
                  type="button"
                  onClick={handlePlay}
                  className="rounded-full bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-6 py-3 text-sm font-medium text-[#050814] hover:opacity-95"
                >
                  Putar video
                </button>
                <p className="text-xs text-[#fdf3d8]/80">Video siap diputar</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm leading-relaxed text-[#fdf3d8]/80">{INTRO_LINE}</p>
            <div className="flex flex-wrap gap-2">
              {muted ? (
                <button
                  type="button"
                  onClick={handleSound}
                  className="rounded-lg border border-[#f6d77a]/40 px-4 py-2 text-sm text-[#f6d77a] hover:bg-[#f6d77a]/10"
                >
                  Nyalakan suara
                </button>
              ) : (
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-[#fdf3d8]/90 hover:bg-white/5"
                >
                  Bisukan
                </button>
              )}
              <button
                type="button"
                onClick={goToGallery}
                className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-5 py-2 text-sm font-medium text-[#050814] hover:opacity-95"
              >
                Lewati video
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- gallery */

  return (
    <div className="space-y-6 motion-safe:transition-opacity motion-safe:duration-700">
      {intro && introFailed && (
        <div
          role="status"
          className="rounded-2xl border border-amber-300/40 bg-amber-400/10 px-5 py-4 space-y-1"
        >
          <h2 className="font-display text-base text-amber-100">Video pembuka gagal dimuat</h2>
          <p className="text-sm text-amber-100/85">
            Video pembuka tidak dapat diputar. Anda tetap dapat melihat galeri di bawah ini.
          </p>
        </div>
      )}

      <ArchiveGalleryView photos={experience?.photos ?? []} videos={experience?.videos ?? []} />
    </div>
  );
}
