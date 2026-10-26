"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  EMPTY_ARCHIVE_DRAFT,
  loadArchiveDraft,
  splitNarrative,
  type PrivateArchiveDraft,
} from "@/lib/archive/draft";

/**
 * Admin-only preview of the private archive ("Tentang Ibumu").
 *
 * SAFETY / HONESTY:
 * - Reads only the BROWSER-LOCAL draft. It never touches server private data,
 *   so there is no `?preview=1` PIN bypass and no publication-status change.
 * - No fabricated photos or narrative: only what the admin actually typed.
 *   With no real media assets, it shows an honest empty state.
 * - Respects `prefers-reduced-motion`.
 */

export default function ArchivePreviewPage() {
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState<PrivateArchiveDraft>(EMPTY_ARCHIVE_DRAFT);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDraft(loadArchiveDraft());
      if (reduce) setOpened(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [reduce]);

  const title = draft.title.trim() || "Tentang Ibumu";
  const paragraphs = splitNarrative(draft.narrative);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/admin/archive"
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-[#fdf3d8]/90 hover:bg-white/5 transition-colors"
        >
          ← Kembali ke panel admin
        </Link>
        <span className="text-xs uppercase tracking-[0.25em] text-[#f6d77a]">Pratinjau admin</span>
      </div>

      <p className="rounded-lg border border-[#f6d77a]/30 bg-[#f6d77a]/10 px-4 py-3 text-xs text-[#fdf3d8]/80">
        Ini pratinjau admin, bukan halaman publik. Tidak ada PIN yang dilewati, tidak ada perubahan status
        publikasi, dan tidak ada media privat yang dibuka tanpa otorisasi.
      </p>

      {!opened ? (
        <section className="flex flex-col items-center gap-8 py-16 text-center">
          <motion.div
            aria-hidden="true"
            className="relative h-40 w-40 rounded-lg border border-[#e9c67c]/40 bg-gradient-to-b from-[#1b2f5e] via-[#0f1b3a] to-[#050a18] shadow-[0_32px_60px_-24px_rgba(0,0,0,0.95)]"
            animate={reduce ? { y: 0 } : { y: [0, -6, 0] }}
            transition={reduce ? { duration: 0.2 } : { duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-8 py-3 text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] hover:brightness-110 transition"
          >
            Buka Arsip
          </button>
        </section>
      ) : (
        <section className="space-y-8">
          <div className="text-center space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-[#f6d77a]">Arsip Privat</p>
            <h1 className="font-display text-3xl sm:text-4xl text-[#fdf3d8]">{title}</h1>
          </div>

          {paragraphs.length > 0 ? (
            <div className="mx-auto max-w-2xl space-y-4">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className="font-serif leading-relaxed text-[#fdf3d8]/85">
                  {paragraph}
                </p>
              ))}
            </div>
          ) : (
            <p className="mx-auto max-w-xl rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-[#fdf3d8]/70">
              Belum ada narasi pada draf. Narasi tidak dibuat-buat.
            </p>
          )}

          <div className="mx-auto max-w-2xl">
            <h2 className="text-sm font-medium text-[#fdf3d8] mb-3">Foto Kenangan</h2>
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-[#fdf3d8]/70">
              Belum ada media arsip tersimpan. Tidak ada foto contoh yang dibuat.
            </div>
          </div>

        </section>
      )}
    </div>
  );
}
