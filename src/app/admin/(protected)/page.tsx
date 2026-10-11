import Link from "next/link";

/**
 * Dashboard admin.
 *
 * All previous statistic/activity/memory cards were mock demo data with no real
 * source, so they were removed. Only real navigation remains.
 */
export default function AdminDashboard() {
  return (
    <div className="space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Dashboard</h1>
          <p className="text-sm text-[#fdf3d8]/70 mt-3">Selamat datang kembali.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-8 space-y-2 text-center">
        <p className="font-medium text-[#fdf3d8]">Belum ada ringkasan data.</p>
        <p className="mx-auto max-w-xl text-sm text-[#fdf3d8]/70">
          Statistik, aktivitas, dan kenangan belum ditampilkan karena belum ada sumber data nyata.
          Gunakan menu di samping untuk mulai mengelola surat, media, dan tema.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-display tracking-wide text-[#fdf3d8] mb-5">Akses Cepat</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/admin/birthday" label="Tulis Surat" />
          <QuickLink href="/admin/themes" label="Katalog Tema Tahunan" />
          <QuickLink href="/admin/media" label="Pustaka Media" />
          <QuickLink href="/admin/memories" label="Arsip Kenangan" />
        </div>
      </div>
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
