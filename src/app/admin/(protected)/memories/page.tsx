"use client";

/**
 * Arsip Kenangan — arsip perjalanan ulang tahun Vanka, dari usia 1 sampai 17.
 *
 * No mock data. Edition↔memory relations are not implemented in the current
 * storage (the theme registry is metadata only, not a memory archive), so this
 * page shows an honest empty state instead of fabricated editions or counts.
 */
export default function AdminMemoriesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Arsip Kenangan</h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-2">
          Arsip perjalanan ulang tahun Vanka, dari usia 1 hingga 17.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-8 space-y-3 text-center">
        <p className="font-medium text-[#fdf3d8]">Belum ada arsip edisi.</p>
        <p className="mx-auto max-w-xl text-sm text-[#fdf3d8]/70">
          Arsip ulang tahun akan muncul di sini setelah edisi benar-benar dibuat dan disimpan.
        </p>
      </div>

      <div className="rounded-2xl border border-[#f6d77a]/30 bg-[#f6d77a]/10 px-5 py-4 text-sm text-[#fdf3d8]/85 space-y-1">
        <p className="font-medium text-[#fdf3d8]">Catatan arsitektur</p>
        <p>
          Relasi antara edisi ulang tahun dan kenangan belum tersedia, dan belum ada penyimpanan
          edisi. Katalog Tema Tahunan (menu terpisah) hanya metadata tema — bukan arsip kenangan.
          Media tidak dihubungkan ke edisi hanya berdasarkan tahun upload. Karena itu tidak ada
          daftar edisi, jumlah kenangan, atau progres yang ditampilkan.
        </p>
      </div>
    </div>
  );
}
