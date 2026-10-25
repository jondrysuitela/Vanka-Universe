"use client";

import { useEffect } from "react";

import BirthdayExperiencePlayer from "./BirthdayExperiencePlayer";

/**
 * Landing-page overlay for the birthday ITSELF.
 *
 * On 27 October (00:00 → 28 October 00:00 WIT) the experience takes over the
 * landing page: it covers the whole viewport, over the dashboard, and its own
 * gift-box opening is the first thing a visitor meets. The visitor can close it
 * to read the landing page; the chapter card then re-opens the same overlay.
 *
 * Only ever rendered for the birthday day (`publicExperiencePhase` ===
 * "birthday" in `experience-open.ts`). From the next day on, the experience
 * lives in the Memory Archive instead (see `public-editions.ts`).
 */
export default function BirthdayOverlay({
  editionAge,
  editionYear,
  onClose,
}: {
  /** Edition played by the overlay (the birthday being celebrated). */
  editionAge: number;
  /** CALENDAR YEAR of that edition (age 1 → 2026). */
  editionYear: number;
  onClose: () => void;
}) {
  // Close on Escape, like any other dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vanka Experience — ulang tahun Vanka"
      className="fixed inset-0 z-[150] overflow-y-auto"
    >
      {/* Full-bleed night sky, so the dashboard behind is never half-visible. */}
      <div aria-hidden="true" className="cosmos-sky fixed inset-0" />
      <div aria-hidden="true" className="cosmos-aurora-a fixed -top-32 left-[8%] h-[55vmin] w-[55vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-b fixed right-[4%] top-[30%] h-[45vmin] w-[45vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-c fixed bottom-[-10%] left-[30%] h-[60vmin] w-[60vmin]" />
      <div aria-hidden="true" className="cosmos-vignette fixed inset-0" />

      <div className="relative z-10">
        <BirthdayExperiencePlayer
          draftPreview={false}
          draftAge={editionAge}
          editionAge={editionAge}
          editionYear={editionYear}
          overlay
          onClose={onClose}
        />

      </div>
    </div>
  );
}
