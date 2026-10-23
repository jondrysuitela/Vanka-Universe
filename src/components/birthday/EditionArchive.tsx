"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  editionHref,
  listPublicEditions,
  type PublicEdition,
} from "@/lib/birthday/public-editions";

/**
 * Memory Archive chapter — every birthday Vanka has had, newest first.
 *
 * CONTENT: the editions come from the static theme registry via
 * `listPublicEditions`, so a year is listed only after its own birthday and its
 * title, subtitle, palette and note are that year's theme — nothing is
 * hand-written a second time here.
 *
 * LOOK: each card is dressed in its own theme palette (`palette.primary`,
 * `secondary`, `accent`, `text`), so the archive visibly grows year by year
 * instead of repeating one design.
 *
 * The date check runs in an effect on the BROWSER clock (the server has no
 * visitor clock); until then the honest "not open yet" state is shown.
 */
export default function EditionArchive() {
  /** `null` until the browser clock has been read. */
  const [editions, setEditions] = useState<PublicEdition[] | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setEditions(listPublicEditions(new Date()));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (editions === null) return null;

  if (editions.length === 0) {
    return (
      <p
        role="status"
        className="backdrop-blur-glass rounded-3xl p-8 text-center font-serif leading-relaxed text-white/75"
      >
        Belum ada ulang tahun yang tayang. Edisi pertama terbuka pada 27 Oktober
        2026, dan setiap tahun sesudahnya akan menambah bab baru di sini.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-6">
      {editions.map((edition) => (
        <li key={edition.year}>
          <EditionCard edition={edition} />
        </li>
      ))}
    </ol>
  );
}

function EditionCard({ edition }: { edition: PublicEdition }) {
  const { palette } = edition;

  return (
    <article
      className="relative overflow-hidden rounded-3xl border p-7 sm:p-9"
      style={{
        backgroundColor: palette.surface,
        borderColor: `${palette.accent}55`,
        color: palette.text,
      }}
    >
      {/* The theme's own three-stop gradient, kept as a soft wash. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage: `linear-gradient(140deg, ${palette.gradient[0]} 0%, ${palette.gradient[1]} 55%, ${palette.gradient[2]} 100%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-2xl"
        style={{ backgroundColor: `${palette.accent}26` }}
      />

      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="rounded-full border px-3 py-1 font-sans text-[0.6rem] font-semibold uppercase tracking-[0.28em]"
            style={{ borderColor: `${palette.accent}66`, color: palette.accent }}
          >
            Usia {edition.age} · {edition.year}
          </span>
          <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] opacity-70">
            {edition.dateLabel}
          </span>
          {edition.isBirthdayToday && (
            <span
              className="rounded-full px-3 py-1 font-sans text-[0.6rem] font-bold uppercase tracking-[0.28em]"
              style={{ backgroundColor: palette.accent, color: palette.gradient[0] }}
            >
              Hari ini
            </span>
          )}
        </div>

        <div>
          <h3 className="font-display text-2xl leading-snug sm:text-3xl">{edition.title}</h3>
          <p className="mt-1 font-serif italic opacity-80">{edition.subtitle}</p>
        </div>

        <p className="font-serif leading-relaxed opacity-75">{edition.readinessNote}</p>

        {edition.readiness === "implemented" ? (
          <Link
            href={editionHref(edition.age)}
            className="inline-flex w-fit items-center gap-2 rounded-full px-6 py-3 font-sans text-[0.68rem] font-bold uppercase tracking-[0.24em] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4"
            style={{ backgroundColor: palette.accent, color: palette.gradient[0] }}
          >
            Putar Ulang Pengalaman
            <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <p className="font-sans text-xs uppercase tracking-[0.25em] opacity-60">
            Pengalaman tahun ini belum dibangun
          </p>
        )}
      </div>
    </article>
  );
}
