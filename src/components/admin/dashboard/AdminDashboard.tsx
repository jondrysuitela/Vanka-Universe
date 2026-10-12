"use client";

import Link from "next/link";

import { cycleForDate, latestRevealedCycle, type BirthdayCycle } from "@/lib/birthday/cycle";
import { formatBirthdayDate, getThemeByAge } from "@/lib/birthday/theme-registry";

/**
 * Dashboard admin (Tahap 4G.42B).
 *
 * Hanya navigasi + badge edisi ulang tahun yang akan tayang (dari katalog tema).
 * TIDAK menampilkan media/statistik: itu milik Pustaka Media. Setiap badge
 * edisi punya tombol preview pengalaman (`?preview=1&full=1&age=N`): preview
 * menjalankan SELURUH pengalaman dari awal (kotak hadiah → pembuka → surat →
 * kotak kenangan), dengan draf surat admin (termasuk thumbnail) dimuat.
 *
 * Logika edisi memakai kebijakan siklus (
 * `cycleForDate` / `latestRevealedCycle`): sebelum 27 Oktober hanya badge edisi
 * persiapan (usia 1) muncul; setelah 27 Oktober badge edisi berikutnya ikut
 * muncul.
 */

/** e.g. 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th". */
function ordinal(age: number): string {
  if (age === 1) return "1st";
  if (age === 2) return "2nd";
  if (age === 3) return "3rd";
  return `${age}th`;
}

interface EditionBadge {
  cycle: BirthdayCycle;
  themeTitle: string | null;
  themeSubtitle: string | null;
  revealed: boolean;
}

/** Edisi yang tampil: siklus terakhir yang sudah tayang + siklus persiapan aktif. */
function editionBadges(now: Date): EditionBadge[] {
  const cycles: Array<{ cycle: BirthdayCycle; revealed: boolean }> = [];
  const revealed = latestRevealedCycle(now);
  const prep = cycleForDate(now);
  if (revealed) cycles.push({ cycle: revealed, revealed: true });
  if (prep && (!revealed || revealed.year !== prep.year)) {
    cycles.push({ cycle: prep, revealed: false });
  }
  return cycles.map(({ cycle, revealed }) => {
    const theme = getThemeByAge(cycle.age);
    return {
      cycle,
      themeTitle: theme?.title ?? null,
      themeSubtitle: theme?.subtitle ?? null,
      revealed,
    };
  });
}

export default function AdminDashboard() {
  const badges = editionBadges(new Date());

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Dashboard</h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-3">Selamat datang kembali.</p>
      </div>

      {badges.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-display tracking-wide text-[#fdf3d8]">
            Pengalaman Ulang Tahun
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {badges.map((badge) => (
              <div
                key={badge.cycle.year}
                className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-5 space-y-3"
              >
                <span className="inline-flex w-fit items-center rounded-full border border-[#f6d77a]/40 bg-[#f6d77a]/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-[#f6d77a]">
                  Birthday {ordinal(badge.cycle.age)} · {badge.cycle.year}
                </span>
                <div>
                  <h3 className="font-display text-xl text-[#fdf3d8]">
                    {badge.themeTitle ?? "Tema belum tersedia"}
                  </h3>
                  {badge.themeSubtitle && (
                    <p className="mt-1 text-sm text-[#fdf3d8]/70">{badge.themeSubtitle}</p>
                  )}
                </div>
                <p className="text-xs text-[#fdf3d8]/60">
                  {badge.revealed
                    ? `Sudah tayang sejak ${formatBirthdayDate(badge.cycle.age)}`
                    : `Akan tayang ${formatBirthdayDate(badge.cycle.age)} (WIT)`}
                </p>
                <Link
                  href={`/birthday-experience?preview=1&full=1&age=${badge.cycle.age}`}
                  className="inline-flex items-center rounded-lg border border-[#f6d77a]/40 px-4 py-2 text-sm text-[#f6d77a] transition-colors hover:bg-[#f6d77a]/10"
                >
                  Preview Pengalaman
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-display tracking-wide text-[#fdf3d8] mb-5">Akses Cepat</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/admin/birthday" label="Tulis Surat" />
          <QuickLink href="/admin/themes" label="Katalog Tema Tahunan" />
          <QuickLink href="/admin/media" label="Pustaka Media" />
          <QuickLink href="/admin/memories" label="Arsip Kenangan" />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl px-4 py-3 text-sm text-[#fdf3d8]/90 hover:text-[#fdf3d8] hover:bg-white/5 transition-colors text-center font-medium"
    >
      {label}
    </Link>
  );
}