import Link from "next/link";

import ArchiveExperience from "@/components/admin/archive/ArchiveExperience";

/**
 * Route: /admin/archive/experience (Tahap 4G.39C).
 *
 * Admin-only preview of the Arsip Ibu viewing experience. Access is enforced by
 * the parent `(protected)` layout (`requireSession` + role check); this page adds
 * NO public route and changes NO privacy rule.
 */
export default function ArchiveExperiencePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl tracking-wide text-[#fdf3d8]">
            Pengalaman Arsip Ibu
          </h1>
          <p className="mt-1 text-sm text-[#fdf3d8]/70">
            Pratinjau admin: video pembuka → galeri foto Polaroid. Data dimuat dari server; tidak
            ada data contoh.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/archive"
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5"
          >
            Kelola arsip
          </Link>
          <Link
            href="/admin/dashboard"
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5"
          >
            Dasbor
          </Link>
        </div>
      </div>

      <ArchiveExperience />
    </div>
  );
}
