import { describe, expect, it } from "vitest";

import {
  DEFAULT_MUSIC_FILE,
  MUSIC_MUTED_STORAGE_KEY,
  MUSIC_VOLUME,
  musicFileForAge,
  musicToggleLabel,
  readMutedPreference,
  shouldStartPlayback,
  songForAge,
  writeMutedPreference,
} from "@/lib/birthday/experience-music";

/**
 * Background-music policy. Playback itself needs a browser, but every decision
 * (which file, whether to start, what the button says) is pure and tested here.
 */

describe("musicFileForAge", () => {
  it("looks for an edition's own song under public/music", () => {
    expect(musicFileForAge(1)).toBe("/music/vanka-1.mp3");
    expect(musicFileForAge(17)).toBe("/music/vanka-17.mp3");
  });

  it("is a static asset path, never a media-API route", () => {
    // The song is not private media: it must be cacheable and must not need a
    // session or pass the reveal gate.
    expect(musicFileForAge(1).startsWith("/music/")).toBe(true);
    expect(musicFileForAge(1)).not.toContain("/api/");
  });
});

describe("songForAge", () => {
  it("prefers the edition's own track", () => {
    expect(songForAge(3, true)).toBe("/music/vanka-3.mp3");
  });

  it("falls back to the default song when an edition has none", () => {
    // A replayed old birthday is never silent just because no new track exists.
    expect(songForAge(4, false)).toBe(DEFAULT_MUSIC_FILE);
  });

  it("always resolves to something playable", () => {
    for (const age of [1, 2, 9, 17]) {
      for (const has of [true, false]) {
        expect(songForAge(age, has).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("shouldStartPlayback", () => {
  it("starts only after the visitor's own gesture", () => {
    // Browsers block audio without a gesture; the gift-box click IS that gesture.
    expect(shouldStartPlayback(true, false)).toBe(true);
    expect(shouldStartPlayback(false, false)).toBe(false);
  });

  it("never overrides a muted visitor", () => {
    expect(shouldStartPlayback(true, true)).toBe(false);
  });
});

describe("mute preference", () => {
  it("round-trips", () => {
    expect(readMutedPreference(writeMutedPreference(true))).toBe(true);
    expect(readMutedPreference(writeMutedPreference(false))).toBe(false);
  });

  it("treats a missing or unexpected value as not muted", () => {
    expect(readMutedPreference(null)).toBe(false);
    expect(readMutedPreference("yes-please")).toBe(false);
  });

  it("uses a namespaced key so it cannot collide with the drafts", () => {
    expect(MUSIC_MUTED_STORAGE_KEY.startsWith("vanka:")).toBe(true);
  });
});

describe("musicToggleLabel", () => {
  it("offers the opposite of the current state", () => {
    expect(musicToggleLabel(true)).toBe("Nyalakan musik");
    expect(musicToggleLabel(false)).toBe("Matikan musik");
  });
});

describe("MUSIC_VOLUME", () => {
  it("is background level, not foreground level", () => {
    expect(MUSIC_VOLUME).toBeGreaterThan(0);
    expect(MUSIC_VOLUME).toBeLessThanOrEqual(0.6);
  });
});
