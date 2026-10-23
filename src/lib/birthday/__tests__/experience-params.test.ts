import { describe, expect, it } from "vitest";

import {
  EXPERIENCE_MAX_AGE,
  resolveExperienceParams,
} from "@/lib/birthday/experience-params";

describe("resolveExperienceParams", () => {
  it("public visitor: no draft, default age 1, no jump", () => {
    expect(resolveExperienceParams("")).toEqual({
      fromAdmin: false,
      useDraft: false,
      age: 1,
      openLetter: false,
      openGallery: false,
      editionAge: null,
      editionYear: null,
    });
  });

  it("preview=1 ALONE loads the draft (this is what made the frame empty before)", () => {
    const plan = resolveExperienceParams("?preview=1");
    expect(plan.fromAdmin).toBe(true);
    expect(plan.useDraft).toBe(true);
    expect(plan.openLetter).toBe(false);
    expect(plan.openGallery).toBe(false);
  });

  it("full=1 (dashboard/editor link) loads the draft and starts from the gift box", () => {
    const plan = resolveExperienceParams("?preview=1&full=1&age=1");
    expect(plan).toMatchObject({ fromAdmin: true, useDraft: true, age: 1, openLetter: false });
    expect(plan.openGallery).toBe(false);
  });

  it("letter=1 opens the draft letter straight away", () => {
    const plan = resolveExperienceParams("?preview=1&letter=1&age=3");
    expect(plan).toMatchObject({ useDraft: true, age: 3, openLetter: true, openGallery: false });
  });

  it("gallery=1 lands on the memory box and still loads the draft", () => {
    const plan = resolveExperienceParams("?preview=1&gallery=1");
    expect(plan).toMatchObject({ useDraft: true, openGallery: true, openLetter: false });
  });

  it("full=1 without preview is still an admin draft preview", () => {
    expect(resolveExperienceParams("?full=1").useDraft).toBe(true);
    expect(resolveExperienceParams("?full=1").fromAdmin).toBe(false);
  });

  it("keeps only an in-registry age, else falls back to 1", () => {
    expect(resolveExperienceParams("?age=17").age).toBe(EXPERIENCE_MAX_AGE);
    for (const bad of ["0", "18", "99", "-1", "abc", "1.5", ""]) {
      expect(resolveExperienceParams(`?preview=1&age=${bad}`).age).toBe(1);
    }
  });

  it("ignores any other flag value (only '1' counts)", () => {
    const plan = resolveExperienceParams("?preview=true&full=yes&gallery=0");
    expect(plan).toMatchObject({ fromAdmin: false, useDraft: false, openGallery: false });
  });

  it("edition=N is a PUBLIC replay, never a draft preview", () => {
    const plan = resolveExperienceParams("?edition=2");
    expect(plan.fromAdmin).toBe(false);
    expect(plan.useDraft).toBe(false);
    expect(plan.editionAge).toBe(2);
    expect(plan.age).toBe(2);
  });

  it("maps the edition AGE onto its CALENDAR YEAR for the API", () => {
    // The letter/gallery endpoints take `year=2026`, never `year=1`.
    expect(resolveExperienceParams("?edition=1").editionYear).toBe(2026);
    expect(resolveExperienceParams("?edition=2").editionYear).toBe(2027);
    expect(resolveExperienceParams("").editionYear).toBeNull();
  });

  it("an admin draft preview never sends a public edition year", () => {
    expect(resolveExperienceParams("?preview=1&age=3").editionAge).toBeNull();
    expect(resolveExperienceParams("?preview=1&age=3").editionYear).toBeNull();
  });

  it("an explicit age wins over the edition it accompanies", () => {
    const plan = resolveExperienceParams("?edition=2&age=3");
    expect(plan).toMatchObject({ editionAge: 2, age: 3 });
  });

  it("keeps only an in-registry edition age", () => {
    for (const bad of ["0", "18", "99", "-1", "abc", "1.5", ""]) {
      expect(resolveExperienceParams(`?edition=${bad}`).editionAge).toBeNull();
    }
    expect(resolveExperienceParams("?edition=17").editionAge).toBe(17);
  });
});
