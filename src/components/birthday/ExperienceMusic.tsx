"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

import {
  MUSIC_FADE_IN_MS,
  MUSIC_FADE_OUT_MS,
  MUSIC_MUTED_STORAGE_KEY,
  MUSIC_VOLUME,
  musicToggleLabel,
  readMutedPreference,
  shouldStartPlayback,
  songForAge,
  writeMutedPreference,
} from "@/lib/birthday/experience-music";
import { musicMediaUrl } from "@/lib/birthday/music/schema";

/**
 * Background music for the Vanka Experience.
 *
 * WHEN: playback starts the moment the gift box opens. That click is the user
 * gesture browsers require, so `autoplay` is honest here rather than a blocked
 * attribute that silently does nothing.
 *
 * WHY A PROBE: an edition's own song (`public/music/vanka-<age>.mp3`) may not
 * exist yet. Rather than 404 in the console and play nothing, we check the file
 * once and fall back to the shared song. `songForAge` decides; this component
 * only supplies the "does the file exist" fact.
 *
 * NEVER ANNOYING: a muted choice is remembered, so a visitor who silenced the
 * music is not re-attacked on the next scene or the next visit.
 *
 * Silent by design until a track exists: with no audio file the element simply
 * stays idle, and the toggle hides itself instead of offering a dead button.
 */

export default function ExperienceMusic({
  age,
  /** Calendar year of the edition — the key the music API is queried by. */
  editionYear,
  /** The gift box has been opened by a click — the gesture that permits audio. */
  started,
  /** Admin draft preview can play an unpublished candidate through the admin media route. */
  adminPreview = false,
  /** Overlay mode sits above the page; the control is placed to suit it. */
  overlay = false,
}: {
  age: number;
  editionYear: number;
  started: boolean;
  adminPreview?: boolean;
  overlay?: boolean;
}) {
  const reduce = useReducedMotion();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);

  const [muted, setMuted] = useState(false);
  /** Resolved once the file probe answers. Null = not probed yet. */
  const [track, setTrack] = useState<string | null>(null);
  const [trackVolume, setTrackVolume] = useState<number | null>(null);
  /** True only after the audio element reports it can actually play. */
  const [available, setAvailable] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  // --- remember the visitor's choice ---------------------------------------
  // Read one frame in, like the draft reads elsewhere in the player: the value
  // lives in `localStorage`, which does not exist during SSR, and setting state
  // synchronously inside an effect would cascade a render.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setMuted(readMutedPreference(window.localStorage.getItem(MUSIC_MUTED_STORAGE_KEY)));
      } catch {
        // Private mode / disabled storage: default to audible, never crash.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // --- resolve which file this edition uses --------------------------------
  // Order of preference:
  //   1. a song uploaded through the admin (candidates in admin preview,
  //      published songs in the public experience);
  //   2. the bundled file `public/music/vanka-<age>.mp3`;
  //   3. the shared bundled fallback.
  // The admin preview deliberately uses the session-gated admin endpoints;
  // public visitors only receive published songs through the date-gated route.
  useEffect(() => {
    let active = true;
    const own = `/music/vanka-${age}.mp3`;
    let resetFrame = 0;
    const resetComplete = new Promise<void>((resolve) => {
      resetFrame = requestAnimationFrame(() => {
        setTrack(null);
        setTrackVolume(null);
        setAvailable(false);
        resolve();
      });
    });

    void (async () => {
      await resetComplete;
      if (!active) return;

      let publishedId: string | null = null;
      let publishedVolume: number | null = null;
      try {
        const res = await fetch(
          adminPreview ? "/api/admin/birthday/music" : `/api/birthday/music?year=${editionYear}`,
          {
            headers: { accept: "application/json" },
            cache: "no-store",
          },
        );
        if (res.ok) {
          const body = (await res.json()) as {
            data?: {
              music?:
                | { mediaId: string | null; volume: number | null }
                | Array<{
                    year: number;
                    mediaId: string | null;
                    volume: number | null;
                  }>
                | null;
            };
          };
          const music = body?.data?.music;
          const editionMusic = adminPreview
            ? Array.isArray(music)
              ? music.find((entry) => entry.year === editionYear) ?? null
              : null
            : !Array.isArray(music)
              ? music
              : null;
          publishedId = editionMusic?.mediaId ?? null;
          const volume = editionMusic?.volume;
          publishedVolume =
            typeof volume === "number" && Number.isFinite(volume)
              ? Math.min(1, Math.max(0, volume))
              : null;
        }
      } catch {
        publishedId = null;
      }
      if (!active) return;
      setTrackVolume(publishedVolume);

      if (publishedId) {
        // Admin drafts use the session-gated media proxy. Public music streams
        // through its own date-gated route, never through the gallery route.
        setTrack(adminPreview ? `/api/media/${publishedId}` : musicMediaUrl(publishedId));
        return;
      }

      let ownExists = false;
      try {
        // HEAD is enough: we only need existence, not the bytes.
        const res = await fetch(own, { method: "HEAD" });
        ownExists = res.ok;
      } catch {
        ownExists = false;
      }
      if (active) setTrack(songForAge(age, ownExists));
    })();

    return () => {
      active = false;
      cancelAnimationFrame(resetFrame);
    };
  }, [age, editionYear, adminPreview]);

  const playbackVolume = trackVolume ?? MUSIC_VOLUME;

  const clearFade = useCallback(() => {
    if (fadeRef.current !== null) {
      window.clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  /** Ramp the element's volume to `to` (ms = 0 → set immediately). */
  const fadeTo = useCallback(
    (to: number, ms: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      clearFade();
      if (ms <= 0) {
        audio.volume = to;
        return;
      }
      const from = audio.volume;
      const steps = Math.max(1, Math.round(ms / 40));
      let step = 0;
      const id = window.setInterval(() => {
        step += 1;
        const progress = Math.min(1, step / steps);
        audio.volume = Math.min(1, Math.max(0, from + (to - from) * progress));
        if (progress >= 1) {
          // Clear the interval DIRECTLY. Calling `clearFade()` here would not
          // work: `fadeRef.current` is still null at this point (the id is
          // assigned after `setInterval` returns), so the fade was left running
          // and the volume could stop short of its target.
          window.clearInterval(id);
          if (fadeRef.current === id) fadeRef.current = null;
        }
      }, 40);
      fadeRef.current = id;
    },
    [clearFade],
  );

  // --- start / stop -------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || track === null) return;

    const mustStop = () => {
      fadeTo(0, reduce ? 0 : MUSIC_FADE_OUT_MS);
      window.setTimeout(() => {
        if (audio.volume === 0) audio.pause();
      }, reduce ? 0 : MUSIC_FADE_OUT_MS + 20);
    };

    if (!shouldStartPlayback(started, muted)) {
      mustStop();
      return;
    }

    // Start quiet, then ramp — the song fills in under the box's own motion.
    audio.volume = reduce ? playbackVolume : 0;
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {
        // If the async track lookup outlives the browser's gesture window, offer
        // a deliberate play button instead of silently leaving preview muted.
        setAvailable(false);
        setPlaybackBlocked(true);
      });
    }
    if (!reduce) fadeTo(playbackVolume, MUSIC_FADE_IN_MS);
    else audio.volume = playbackVolume;

    return clearFade;
  }, [started, muted, track, trackVolume, playbackVolume, reduce, fadeTo, clearFade]);

  // --- pause when the tab is hidden, resume when it comes back -------------
  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (document.visibilityState === "hidden") {
        audio.pause();
      } else if (started && !muted && available) {
        void audio.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [started, muted, available]);

  useEffect(() => clearFade, [clearFade]);

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    try {
      window.localStorage.setItem(MUSIC_MUTED_STORAGE_KEY, writeMutedPreference(next));
    } catch {
      // Storage unavailable: the choice still holds for this visit.
    }
    const audio = audioRef.current;
    if (next) {
      if (audio) fadeTo(0, reduce ? 0 : MUSIC_FADE_OUT_MS);
      window.setTimeout(() => audioRef.current?.pause(), reduce ? 0 : MUSIC_FADE_OUT_MS + 20);
      return;
    }
    // Turning it back on is itself a gesture, so play() is allowed.
    if (audio) {
      audio.volume = reduce ? playbackVolume : 0;
      void audio.play().catch(() => {});
      if (!reduce) fadeTo(playbackVolume, MUSIC_FADE_IN_MS);
    }
  }

  function startPlaybackFromGesture() {
    const audio = audioRef.current;
    if (!audio || track === null) return;
    setMuted(false);
    setPlaybackBlocked(false);
    audio.volume = reduce ? playbackVolume : 0;
    const attempt = audio.play();
    if (attempt && typeof attempt.catch === "function") {
      attempt.catch(() => {
        setAvailable(false);
        setPlaybackBlocked(true);
      });
    }
    if (!reduce) fadeTo(playbackVolume, MUSIC_FADE_IN_MS);
  }

  return (
    <>
      {track !== null && (
        <audio
          ref={audioRef}
          src={track}
          loop
          preload="auto"
          // `playing` (not `canplay`) is the honest signal: the toggle must only
          // offer "mute" once sound is actually coming out.
          onPlaying={() => {
            setAvailable(true);
            setPlaybackBlocked(false);
          }}
          onError={() => {
            setAvailable(false);
            setPlaybackBlocked(false);
          }}
        />
      )}

      {started && track !== null && playbackBlocked && (
        <button
          type="button"
          onClick={startPlaybackFromGesture}
          aria-label="Putar musik"
          className={`absolute z-40 inline-flex items-center gap-2 rounded-full border border-[#e9c67c]/50 bg-[#0b1226]/90 px-4 py-2 font-sans text-xs font-semibold uppercase tracking-[0.16em] text-[#f6e3b2] shadow-lg backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] ${
            overlay ? "right-20 top-5" : "right-4 top-5"
          }`}
        >
          <SpeakerGlyph />
          Putar musik
        </button>
      )}

      {/* Only offered once a real track is playing — no dead button. */}
      {available && !playbackBlocked && (
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={!muted}
          aria-label={musicToggleLabel(muted)}
          title={musicToggleLabel(muted)}
          className={`absolute z-40 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#e9c67c]/40 bg-[#0b1226]/80 text-[#f6e3b2] backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] ${
            overlay ? "right-20 top-5" : "right-4 top-5"
          }`}
        >
          {muted ? <SpeakerOffGlyph /> : <SpeakerGlyph />}
        </button>
      )}
    </>
  );
}

function SpeakerGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18 6a9 9 0 0 1 0 12" />
    </svg>
  );
}

function SpeakerOffGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4"
    >
      <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
      <path d="m16 9.5 5 5" />
      <path d="m21 9.5-5 5" />
    </svg>
  );
}
