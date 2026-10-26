"use client";

import { useEffect } from "react";

import BirthdayExperiencePlayer from "./BirthdayExperiencePlayer";

/**
 * Landing-page overlay for the birthday ITSELF.
 *
 * On 27 October (00:00 → 28 October 00:00 WIT) the experience takes over the
 * landing page: it covers the whole viewport, over the dashboard, and begins at
 * the gift-box opening. When pre-mounted during the countdown, it stays hidden
 * until the birthday celebration finishes. The visitor can close it to read
 * the landing page; the chapter card then re-opens the same overlay.
 *
 * Only ever rendered for the birthday day (`publicExperiencePhase` ===
 * "birthday" in `experience-open.ts`). From the next day on, the experience
 * lives in the Memory Archive instead (see `public-editions.ts`).
 */
export default function BirthdayOverlay({
  editionAge,
  editionYear,
  autoStartMusic = false,
  autoOpenGift = false,
  onClose,
}: {
  /** Edition played by the overlay (the birthday being celebrated). */
  editionAge: number;
  /** CALENDAR YEAR of that edition (age 1 → 2026). */
  editionYear: number;
  /** Starts playback at the birthday countdown's reveal instant. */
  autoStartMusic?: boolean;
  /** Opens the experience directly after the countdown's continue action. */
  autoOpenGift?: boolean;
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
      <div className="relative z-10">
        <BirthdayExperiencePlayer
          draftPreview={false}
          draftAge={editionAge}
          editionAge={editionAge}
          editionYear={editionYear}
          overlay
          autoStartMusic={autoStartMusic}
          autoOpenGift={autoOpenGift}
          onClose={onClose}
        />

      </div>
    </div>
  );
}
