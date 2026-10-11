/**
 * Minimal browser-API stubs for jsdom (Tahap 4B).
 *
 * jsdom does not implement `IntersectionObserver` or `window.matchMedia`, which
 * `framer-motion` (used by the public dashboard) touches on render. Import this
 * module FIRST so the stubs exist before React/framer-motion are evaluated.
 *
 * No-op only: these tests assert static content (cards, hrefs, copy), never
 * viewport-driven animation behaviour.
 */

class NoopIntersectionObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}

(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
  NoopIntersectionObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

export {};
