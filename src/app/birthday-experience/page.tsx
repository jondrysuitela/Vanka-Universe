"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ExperienceScene, {
  LETTER_SCENE_INDEX,
  SCENE_COUNT,
} from "@/components/birthday/ExperienceScene";
import GiftBoxIntro from "@/components/birthday/GiftBoxIntro";
import {
  DEFAULT_LETTER_DRAFT,
  EMPTY_LETTER_DRAFT,
  loadLetterForAge,
  type LetterDraft,
} from "@/components/birthday/LetterScene";

export default function BirthdayExperiencePage() {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);
  const [fromAdmin, setFromAdmin] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [letterDraft, setLetterDraft] = useState<LetterDraft>(DEFAULT_LETTER_DRAFT);
  const [letterPreview, setLetterPreview] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      setFromAdmin(params.get("preview") === "1");

      // `letter=1` → open the (edited) letter draft straight away.
      // `age=N` (1–17) selects which edition's letter to preview; defaults to 1.
      if (params.get("letter") === "1") {
        const ageRaw = Number(params.get("age") ?? "1");
        const age = Number.isInteger(ageRaw) && ageRaw >= 1 && ageRaw <= 17 ? ageRaw : 1;
        const stored = loadLetterForAge(age);
        setLetterDraft(stored ?? EMPTY_LETTER_DRAFT);
        setLetterPreview(true);
        setRevealed(true);
        setActive(LETTER_SCENE_INDEX);
      }

      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const next = useCallback(() => {
    setActive((current) => Math.min(current + 1, SCENE_COUNT - 1));
  }, []);

  const prev = useCallback(() => {
    setActive((current) => Math.max(current - 1, 0));
  }, []);

  const restart = useCallback(() => setActive(0), []);

  return (
    <main className="relative min-h-dvh">
      {/* shared night-sky backdrop */}
      <div aria-hidden="true" className="cosmos-sky absolute inset-0" />
      <div aria-hidden="true" className="cosmos-aurora-a absolute -top-32 left-[8%] h-[55vmin] w-[55vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-b absolute right-[4%] top-[30%] h-[45vmin] w-[45vmin]" />
      <div aria-hidden="true" className="cosmos-aurora-c absolute bottom-[-10%] left-[30%] h-[60vmin] w-[60vmin]" />
      <div aria-hidden="true" className="cosmos-vignette absolute inset-0" />

      {fromAdmin && (
        <Link
          href="/admin/birthday"
          className="absolute left-4 top-5 z-30 rounded-full border border-[#e9c67c]/40 bg-[#0b1226]/80 px-4 py-2 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-[#f6e3b2] backdrop-blur-md transition duration-300 hover:border-[#e9c67c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          ← Back to admin
        </Link>
      )}

      {ready &&
        (revealed ? (
          <ExperienceScene
            active={active}
            onNext={next}
            onPrev={prev}
            onRestart={restart}
            letterDraft={letterDraft}
            letterPreview={letterPreview}
            thumbnail={letterDraft.thumbnail}
          />
        ) : (
          <GiftBoxIntro onOpen={() => setRevealed(true)} />
        ))}
    </main>
  );
}
