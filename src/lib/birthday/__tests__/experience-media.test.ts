import { describe, expect, it } from "vitest";

import {
  mediaUrlFor,
  resolveMediaRoute,
} from "@/lib/birthday/experience-media";

describe("resolveMediaRoute", () => {
  it("uses the ADMIN route for the admin draft preview", () => {
    // The admin must see media BEFORE the birthday; the public route is
    // date-gated and would show nothing.
    expect(resolveMediaRoute(true)).toBe("admin");
  });

  it("uses the PUBLIC route for a public visitor", () => {
    expect(resolveMediaRoute(false)).toBe("public");
  });
});

describe("mediaUrlFor", () => {
  it("builds the session-gated admin URL", () => {
    expect(mediaUrlFor("admin", "abc")).toBe("/api/media/abc");
  });

  it("builds the date-gated public URL", () => {
    expect(mediaUrlFor("public", "abc")).toBe("/api/birthday/gallery/media/abc");
  });

  it("returns a STRING for every route — never a builder function", () => {
    // Regression guard: the builder used to be stored in state with the
    // updater form, so the state held "/api/media/undefined" (a string)
    // instead of the function. The decision is a string now, so a caller can
    // never accidentally treat it as an updater.
    for (const route of ["public", "admin"] as const) {
      expect(typeof mediaUrlFor(route, "abc")).toBe("string");
    }
  });
});
