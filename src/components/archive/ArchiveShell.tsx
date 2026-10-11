import type { ReactNode } from "react";

import Link from "next/link";

import CosmicBackdrop from "@/components/CosmicBackdrop";

/**
 * Shared chrome for the public-facing Arsip Privat visitor route (Tahap 4A).
 *
 * Visual language matches the Dashboard and Birthday Experience (same night-sky
 * backdrop, gold accents, display/serif/script type). The back link uses a
 * plain anchor to `/` because the visitor screen is a standalone public route.
 */
export default function ArchiveShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-dvh">
      <CosmicBackdrop />

      <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-6 py-12 sm:px-10 sm:py-16">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-3 rounded-full border border-white/20 px-5 py-2.5 font-sans text-[0.68rem] uppercase tracking-[0.3em] text-white/75 transition hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c]"
        >
          <span aria-hidden="true">←</span>
          <span>{"Return to Vanka's Universe"}</span>
        </Link>

        {children}
      </div>
    </main>
  );
}
