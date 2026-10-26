"use client";

import { useCallback, useEffect, useState } from "react";

import ArchivePhotoGallery from "@/components/archive/ArchivePhotoGallery";
import {
  ARCHIVE_VISITOR_MESSAGES,
  experienceMediaUrl,
  mapExperienceOutcome,
  narrativeParagraphs,
  parseVisitorExperience,
  type VisitorExperienceData,
} from "@/lib/archive/visitor";

/**
 * Arsip Privat — read-only visitor experience (Tahap VU-ARCHIVE-ACCESS-4A).
 *
 * Loads `GET /api/archive/experience` (visitor session only). It renders the
 * archive's OWN title/narrative (never substitute copy), the intro video, and
 * the video/photo gallery — all media through the authenticated visitor proxy.
 *
 * Honest states:
 *  - `401` → the visitor session is gone: `onSessionEnded()` returns to the PIN gate.
 *  - `503` → "archive not ready"; private data is NOT opened (no empty gallery pretence).
 *
 * Reduced motion is respected with `motion-safe:` transitions.
 */

type LoadState =
  | { status: "loading" }
  | { status: "ok"; data: VisitorExperienceData }
  | { status: "not_ready" }
  | { status: "error" };

export default function ArchiveVisitorExperience({
  onSessionEnded,
}: {
  /** Called when the session is invalid/ended (401) and after re-locking. */
  onSessionEnded: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [introFailed, setIntroFailed] = useState(false);
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/archive/experience", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const outcome = mapExperienceOutcome(response.status);

        if (outcome === "unauthorized") {
          if (active) onSessionEnded();
          return;
        }
        if (outcome === "not_ready") {
          if (active) setState({ status: "not_ready" });
          return;
        }
        if (outcome === "error") {
          if (active) setState({ status: "error" });
          return;
        }

        const body = (await response.json().catch(() => null)) as
          | { data?: unknown }
          | null;
        const data = parseVisitorExperience(body?.data);
        if (!active) return;
        setState(data ? { status: "ok", data } : { status: "error" });
      } catch {
        if (active) setState({ status: "error" });
      }
    })();
    return () => {
      active = false;
    };
  }, [onSessionEnded]);

  const lock = useCallback(async () => {
    setLocking(true);
    try {
      await fetch("/api/archive/access/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({}),
      });
    } catch {
      // The cookie is cleared server-side even on partial failure; either way we
      // return to the PIN gate and the next load re-checks the session.
    }
    onSessionEnded();
  }, [onSessionEnded]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-4 py-1.5 font-sans text-[0.65rem] uppercase tracking-[0.35em] text-[#f6e3b2] backdrop-blur-md">
        Arsip Privat
      </span>
      <button
        type="button"
        onClick={lock}
        disabled={locking}
        className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-2.5 font-sans text-[0.68rem] font-semibold uppercase tracking-[0.25em] text-white/80 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:opacity-60"
      >
        <span aria-hidden="true">⌂</span>
        {locking ? "Mengunci…" : "Kunci ulang"}
      </button>
    </div>
  );

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <p role="status" className="text-center font-serif text-lg text-white/70">
          Memuat arsip…
        </p>
      </div>
    );
  }

  if (state.status !== "ok") {
    const title =
      state.status === "not_ready" ? "Arsip belum siap" : "Gagal memuat arsip";
    const message =
      state.status === "not_ready"
        ? ARCHIVE_VISITOR_MESSAGES.notReady
        : ARCHIVE_VISITOR_MESSAGES.loadError;
    return (
      <div className="flex flex-col gap-8">
        {header}
        <div
          role="status"
          className="backdrop-blur-glass mx-auto w-full max-w-xl rounded-3xl p-8 text-center"
        >
          <h2 className="font-display text-2xl text-[#f6e3b2]">{title}</h2>
          <p className="mt-3 font-serif leading-relaxed text-white/75">{message}</p>
        </div>
      </div>
    );
  }

  const { data } = state;
  const paragraphs = narrativeParagraphs(data.narrative);

  return (
    <div className="flex flex-col gap-10 motion-safe:transition-opacity motion-safe:duration-700">
      {header}

      {(data.title || paragraphs.length > 0) && (
        <header className="flex flex-col items-center gap-4 text-center">
          {data.title && (
            <h1 className="text-shadow-lg font-display text-4xl text-[#f6e3b2] sm:text-5xl">
              {data.title}
            </h1>
          )}
          {paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="max-w-3xl font-serif text-lg leading-relaxed text-white/80 sm:text-xl"
            >
              {paragraph}
            </p>
          ))}
        </header>
      )}

      {data.introMediaId && !introFailed && (
        <div className="backdrop-blur-glass overflow-hidden rounded-3xl p-3 sm:p-4">
          <div className="overflow-hidden rounded-2xl bg-black">
            <video
              src={experienceMediaUrl(data.introMediaId)}
              controls
              playsInline
              preload="metadata"
              aria-label="Video pembuka arsip"
              className="mx-auto max-h-[70vh] w-full bg-black object-contain"
              onError={() => setIntroFailed(true)}
            />
          </div>
        </div>
      )}

      {data.introMediaId && introFailed && (
        <p
          role="status"
          className="mx-auto w-full max-w-2xl rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-center text-sm text-amber-100"
        >
          {ARCHIVE_VISITOR_MESSAGES.introFailed}
        </p>
      )}

      {data.photos.length > 0 || data.videos.length > 0 ? (
        <ArchivePhotoGallery photos={data.photos} videos={data.videos} />
      ) : (
        !data.introMediaId && (
          <p className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/70">
            {ARCHIVE_VISITOR_MESSAGES.empty}
          </p>
        )
      )}
    </div>
  );
}
