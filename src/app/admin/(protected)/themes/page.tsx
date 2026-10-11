import {
  BIRTHDAY_THEMES,
  formatBirthdayDate,
  type ThemeReadiness,
} from "@/lib/birthday/theme-registry";

/**
 * Katalog Tema Tahunan (admin).
 *
 * Read-only. Reads the single source of truth (`BIRTHDAY_THEMES`) directly —
 * no duplicated list. This is METADATA only: it is NOT a memory archive, and
 * ages 2–17 are concepts, not built experiences. Nothing here is persisted.
 */

/** Read-only labels for the annual theme catalog. */
const READINESS_LABEL: Record<ThemeReadiness, string> = {
  implemented: "Sudah Diimplementasikan",
  concept: "Konsep",
};

export default function AdminThemesPage() {
  const implemented = BIRTHDAY_THEMES.filter((t) => t.readiness === "implemented").length;
  const concept = BIRTHDAY_THEMES.length - implemented;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">
          Katalog Tema Tahunan
        </h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-2">
          Katalog metadata read-only untuk {BIRTHDAY_THEMES.length} tema ulang tahun (usia 1–17),
          dibaca langsung dari registry. {concept} tema masih konsep — belum menjadi pengalaman
          visual yang berfungsi. Data ini tidak disimpan di server.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3 text-xs text-[#fdf3d8]/70">
          <span className="rounded-full border border-[#7fe3a1]/40 bg-[#7fe3a1]/10 px-3 py-1 text-[#b6f5cd]">
            {implemented} Sudah Diimplementasikan
          </span>
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">
            {concept} Konsep
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BIRTHDAY_THEMES.map((theme) => (
            <div key={theme.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-[#f6d77a]">Usia {theme.age}</p>
                  <h2 className="mt-1 font-medium text-[#fdf3d8]">{theme.title}</h2>
                  <p className="text-xs text-[#fdf3d8]/70 mt-0.5">{theme.subtitle}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.15em] ${
                    theme.readiness === "implemented"
                      ? "border-[#7fe3a1]/40 bg-[#7fe3a1]/10 text-[#b6f5cd]"
                      : "border-white/15 bg-white/5 text-[#fdf3d8]/70"
                  }`}
                >
                  {READINESS_LABEL[theme.readiness]}
                </span>
              </div>

              <dl className="space-y-1 text-xs">
                <div>
                  <dt className="text-[#fdf3d8]/50">Tahun ulang tahun</dt>
                  <dd className="text-[#fdf3d8]/90">{formatBirthdayDate(theme.age)}</dd>
                </div>
                <div>
                  <dt className="text-[#fdf3d8]/50">Slug</dt>
                  <dd className="font-mono text-[0.7rem] text-[#fdf3d8]/80">{theme.slug}</dd>
                </div>
              </dl>

              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[#fdf3d8]/50">Palet</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[
                    theme.palette.primary,
                    theme.palette.secondary,
                    theme.palette.accent,
                    theme.palette.surface,
                    theme.palette.text,
                  ].map((color, ci) => (
                    <span
                      key={`${theme.id}-${ci}`}
                      title={color}
                      aria-label={`Warna ${color}`}
                      className="h-6 w-6 rounded-md border border-white/20"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-[#fdf3d8]/60">{theme.readinessNote}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
