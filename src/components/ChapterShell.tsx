import Link from "next/link";
import type { ReactNode } from "react";
import CosmicBackdrop from "./CosmicBackdrop";

type ChapterShellProps = {
  eyebrow: string;
  statusLabel: string;
  title: string;
  lead: string;
  children: ReactNode;
  nextChapter?: { href: string; label: string };
};

/**
 * Shared layout for the informative placeholder routes. Every link points to
 * a route that actually exists, and the status copy is intentionally honest
 * about what has not been built yet.
 */
export default function ChapterShell({
  eyebrow,
  statusLabel,
  title,
  lead,
  children,
  nextChapter,
}: ChapterShellProps) {
  return (
    <div className="relative min-h-dvh">
      <CosmicBackdrop />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-6 py-12 sm:px-10 sm:py-20">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-3 rounded-full border border-white/20 px-5 py-2.5 font-sans text-[0.68rem] uppercase tracking-[0.3em] text-white/75 transition hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          <span aria-hidden="true">←</span>
          <span>{"Return to Vanka's Universe"}</span>
        </Link>

        <header className="flex flex-col items-start gap-4">
          <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-4 py-1.5 font-sans text-[0.65rem] uppercase tracking-[0.35em] text-[#f6e3b2] backdrop-blur-md">
            {statusLabel}
          </span>
          <p className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
            {eyebrow}
          </p>
          <h1 className="text-shadow-lg font-display text-4xl text-[#f6e3b2] sm:text-5xl">
            {title}
          </h1>
          <p className="font-serif text-lg leading-relaxed text-white/75">
            {lead}
          </p>
        </header>

        <div className="flex flex-col gap-10">{children}</div>

        <nav className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-8 sm:flex-row sm:justify-between">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3 font-sans text-[0.68rem] uppercase tracking-[0.25em] text-white/75 transition hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
          >
            <span aria-hidden="true">←</span>
            Back to the Universe
          </Link>
          {nextChapter ? (
            <Link
              href={nextChapter.href}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-6 py-3 font-sans text-[0.68rem] font-bold uppercase tracking-[0.25em] text-[#20160a] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2]"
            >
              {nextChapter.label}
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </nav>
      </div>
    </div>
  );
}
