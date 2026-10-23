/**
 * Vanka Experience — background music policy.
 *
 * ONE source of truth for WHERE the song lives and WHETHER it should play, so
 * the player component stays thin and every rule is unit-tested here.
 *
 * AUDIO FILES: the song is a real file the author drops into `public/music/`.
 * It is served as a static asset, NOT through the media API — a background
 * track is not private media, it has no per-visitor gating, and it must be
 * cacheable by the browser and the CDN.
 *
 * ONE SONG PER EDITION: the archive replays old birthdays, and a replay must
 * sound like the year it belongs to. `songForAge` resolves that; an edition
 * without its own file falls back to the default song, so an old replay is
 * never silent just because nobody recorded a new track for it.
 *
 * PURE: no I/O, no DOM, no clock. Safe on the client.
 */

/**
 * Where every song is expected, relative to `public/`.
 *
 * An edition's own song: `public/music/vanka-<age>.mp3`.
 * The fallback for editions without one: `public/music/vanka.mp3`.
 */
export const MUSIC_DIR = "/music";

/** Track used when an edition has no song of its own. */
export const DEFAULT_MUSIC_FILE = `${MUSIC_DIR}/vanka.mp3`;

/** Edition song path, e.g. age 1 → `/music/vanka-1.mp3`. */
export function musicFileForAge(age: number): string {
  return `${MUSIC_DIR}/vanka-${age}.mp3`;
}

/**
 * The track an edition should play.
 *
 * `ownTrackAvailable` is supplied by the caller that knows what actually exists
 * (the player probes the file, or a test asserts the mapping). Keeping the
 * existence check OUT of this module is deliberate: a pure function cannot know
 * what is on disk, and pretending otherwise is how "missing file" turns into a
 * silent 404 at runtime.
 */
export function songForAge(age: number, ownTrackAvailable: boolean): string {
  return ownTrackAvailable ? musicFileForAge(age) : DEFAULT_MUSIC_FILE;
}

/** Volume for background music — audible but never louder than the scene. */
export const MUSIC_VOLUME = 0.42;

/**
 * Fade-in length once playback starts.
 *
 * The song begins the instant the gift box opens, so it must not POP in on top
 * of the box's own sound design. A short ramp reads as the room filling with
 * music rather than a switch being thrown.
 */
export const MUSIC_FADE_IN_MS = 1600;

/** Fade-out length when the visitor mutes or leaves. */
export const MUSIC_FADE_OUT_MS = 500;

/**
 * localStorage key remembering the visitor's mute choice.
 *
 * Stored so a visitor who silenced the music is not forced to silence it again
 * on every scene change or revisit — repeatedly auto-playing at someone who
 * already opted out is the behaviour that makes people close the tab.
 */
export const MUSIC_MUTED_STORAGE_KEY = "vanka:music-muted";

/**
 * Should the player attempt to start on its own?
 *
 * Browsers block audio until the page has had a user gesture. The gift box IS
 * that gesture: the visitor clicks it to open the present. So `startedByGesture`
 * is simply "the box has been opened by a click", and this returns whether we
 * may call `play()` without being blocked.
 */
export function shouldStartPlayback(startedByGesture: boolean, muted: boolean): boolean {
  return startedByGesture && !muted;
}

/** Parse the persisted mute flag; anything unexpected means "not muted". */
export function readMutedPreference(raw: string | null): boolean {
  return raw === "1";
}

/** Serialise the mute flag for storage. */
export function writeMutedPreference(muted: boolean): string {
  return muted ? "1" : "0";
}

/** Human label for the music button, in the app's own language. */
export function musicToggleLabel(muted: boolean): string {
  return muted ? "Nyalakan musik" : "Matikan musik";
}
