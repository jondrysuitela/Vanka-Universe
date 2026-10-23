"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import BirthdayExperiencePlayer from "@/components/birthday/BirthdayExperiencePlayer";
import { resolveExperienceParams } from "@/lib/birthday/experience-params";
import {
  FIRST_EXPERIENCE_OPEN_LABEL,
  experienceLockedMessage,
  isFirstExperienceOpen,
} from "@/lib/birthday/experience-open";

/**
 * Public birthday experience page.
 *
 * The player itself lives in `BirthdayExperiencePlayer` and is shared with the
 * landing-page overlay, so both always show the same letter, thumbnail and
 * gallery. This page decides only WHICH experience to play:
 *
 *  - `?preview=1` / `full=1` / `letter=1` — the admin's browser draft.
 *  - `?edition=N` — a public REPLAY of that archived edition (Memory Archive).
 *  - no params — the newest revealed edition.
 *
 * PUBLIC GATE: before the first reveal instant nobody may open the experience
 * here; the page says when it opens instead. The admin preview is never gated.
 */
export default function BirthdayExperiencePage() {
  const [plan, setPlan] = useState<ReturnType<typeof resolveExperienceParams> | null>(null);
  /** `null` until the browser clock has been read (SSR has no visitor clock). */
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const resolved = resolveExperienceParams(window.location.search);
      setPlan(resolved);
      // The admin preview bypasses the date gate; the author must see the
      // experience before the birthday. A public visitor does not.
      setOpen(resolved.fromAdmin || isFirstExperienceOpen(new Date()));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <main className="relative min-h-dvh">
      {/* shared night-sky backdrop */}
      <div aria-hidden="true" className="cosmos-sky absolute inset-0" />
      <div aria-hidden="true" className="cosmos-aurora-a absolute -top-32 left-[8%] h-[55vmin] w-[55vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-b absolute right-[4%] top-[30%] h-[45vmin] w-[45vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-c absolute bottom-[-10%] left-[30%] h-[60vmin]" />
      <div aria-hidden="true" className="cosmos-vignette absolute inset-0" />

      {plan !== null && open === true && (
        <BirthdayExperiencePlayer
          draftPreview={plan.useDraft}
          draftAge={plan.age}
          openLetter={plan.openLetter}
          editionAge={plan.useDraft ? null : plan.editionAge}
          editionYear={plan.useDraft ? null : plan.editionYear}
        />
      )}

      {/*
        Closed for the public until the reveal instant. Nothing of the
        experience — letter, thumbnail, gallery — is rendered here.
      */}
      {open === false && (
        <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
          <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-5 py-2 font-sans text-[0.65rem] font-medium uppercase tracking-[0.4em] text-[#f6e3b2] backdrop-blur-md">
            Masih Dijaga
          </span>
          <h1 className="text-shadow-lg font-display text-3xl leading-snug text-[#f6e3b2] sm:text-4xl">
            {FIRST_EXPERIENCE_OPEN_LABEL}
          </h1>
          <p role="status" className="font-serif text-lg leading-relaxed text-white/75">
            {experienceLockedMessage()}
          </p>
          <p className="font-serif text-base italic text-white/60">
            Sampai tanggal itu, cerita ini hanya untuk Ayah dan Ibu.
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center justify-center rounded-full border border-white/25 px-8 py-3.5 font-sans text-xs font-semibold uppercase tracking-[0.24em] text-white/80 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
          >
            ← Kembali ke Vanka Universe
          </Link>
        </div>
      )}
    </main>
  );
}
