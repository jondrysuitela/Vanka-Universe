"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/admin/ui/ToastProvider";
import { BIRTHDAY_THEMES, formatBirthdayDate } from "@/lib/birthday/theme-registry";
import {
  AUDIO_MIME_TYPES,
  MAX_AUDIO_BYTES,
  type BirthdayMusic,
} from "@/lib/birthday/music/schema";
import { MUSIC_VOLUME } from "@/lib/birthday/experience-music";

/**
 * Musik Ulang Tahun (admin).
 *
 * One row per edition: upload an audio file, then publish it. Until a song is
 * PUBLISHED the public player keeps using the bundled fallback, so a candidate
 * upload can never reach a visitor by accident.
 *
 * The file goes through the normal media upload (`POST /api/media`), which is
 * where the magic-byte sniffing and size caps live. This page then attaches the
 * resulting media id to the edition — it never invents its own storage path.
 */

/** Only MP3 today — the one type the server can verify from the bytes. */
const ACCEPT = `${AUDIO_MIME_TYPES.join(",")},.mp3`;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Year ↔ the label the catalog already uses, so nothing is written twice. */
const EDITIONS = BIRTHDAY_THEMES.map((theme) => ({
  year: theme.year,
  age: theme.age,
  title: theme.title,
  dateLabel: formatBirthdayDate(theme.age),
}));

export default function AdminMusicPage() {
  const { showToast } = useToast();
  const [music, setMusic] = useState<BirthdayMusic[] | null>(null);
  const [busyYear, setBusyYear] = useState<number | null>(null);
  const [volumeDrafts, setVolumeDrafts] = useState<Record<number, number>>({});
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const byYear = new Map((music ?? []).map((entry) => [entry.year, entry]));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/birthday/music", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setMusic([]);
        return;
      }
      const body = (await res.json()) as { data?: { music?: BirthdayMusic[] } };
      setMusic(body?.data?.music ?? []);
    } catch {
      setMusic([]);
    }
  }, []);

  // Load one frame in, like every other deferred read in this app: the fetch
  // resolves asynchronously anyway, and starting it inside the effect body
  // would set state synchronously on the first render.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void refresh();
    });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);

  /** Mutations need the CSRF pair: JSON content type + the custom header. */
  const mutate = useCallback(
    async (method: "PUT" | "PATCH" | "DELETE", body?: unknown, query = "") => {
      return fetch(`/api/admin/birthday/music${query}`, {
        method,
        headers: {
          "content-type": "application/json",
          "x-vanka-request": "1",
          accept: "application/json",
        },
        body: method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
      });
    },
    [],
  );

  async function uploadFor(year: number, file: File) {
    if (file.size > MAX_AUDIO_BYTES) {
      showToast({
        title: "File terlalu besar",
        message: `Maksimal ${formatBytes(MAX_AUDIO_BYTES)} untuk satu lagu.`,
        type: "error",
      });
      return;
    }
    setBusyYear(year);
    try {
      // Reuse the media endpoint: it sniffs the real type from the bytes.
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("collection", "music");
      const upload = await fetch("/api/media", {
        method: "POST",
        headers: { "x-vanka-request": "1" },
        body: form,
      });
      if (!upload.ok) {
        const detail = (await upload.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(detail?.error?.message ?? "Unggahan gagal.");
      }
      const uploaded = (await upload.json()) as { data?: { id?: string } };
      const mediaId = uploaded?.data?.id;
      if (!mediaId) throw new Error("Server tidak mengembalikan id media.");

      const res = await mutate("PUT", { year, mediaId, displayName: file.name, publish: false });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(detail?.error?.message ?? "Gagal memasang lagu pada edisi.");
      }
      await refresh();
      setVolumeDrafts((drafts) => {
        const next = { ...drafts };
        delete next[year];
        return next;
      });
      showToast({
        title: "Lagu terpasang",
        message: `${file.name} dipasang untuk edisi ${year}, belum tayang. Tekan "Tayangkan" untuk mengaktifkannya.`,
        type: "success",
      });
    } catch (error) {
      showToast({
        title: "Gagal",
        message: error instanceof Error ? error.message : "Terjadi kesalahan.",
        type: "error",
      });
    } finally {
      setBusyYear(null);
      const input = fileInputs.current[year];
      if (input) input.value = "";
    }
  }

  async function setPublished(year: number, publish: boolean) {
    setBusyYear(year);
    try {
      const res = await mutate("PATCH", { year, publish });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(detail?.error?.message ?? "Gagal mengubah status tayang.");
      }
      await refresh();
      showToast({
        title: publish ? "Lagu tayang" : "Lagu ditarik",
        message: publish
          ? `Edisi ${year} sekarang memakai lagu ini di pengalaman publik.`
          : `Edisi ${year} kembali memakai lagu bawaan.`,
        type: "success",
      });
    } catch (error) {
      showToast({
        title: "Gagal",
        message: error instanceof Error ? error.message : "Terjadi kesalahan.",
        type: "error",
      });
    } finally {
      setBusyYear(null);
    }
  }

  async function saveVolume(year: number) {
    const entry = byYear.get(year);
    if (!entry?.mediaId) return;
    setBusyYear(year);
    try {
      const res = await mutate("PUT", {
        year,
        mediaId: entry.mediaId,
        displayName: entry.displayName,
        volume: volumeDrafts[year] ?? entry.volume ?? MUSIC_VOLUME,
        publish: entry.publishedAt !== null,
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(detail?.error?.message ?? "Gagal menyimpan volume lagu.");
      }
      await refresh();
      showToast({
        title: "Volume disimpan",
        message: `Volume lagu edisi ${year} berhasil diperbarui.`,
        type: "success",
      });
    } catch (error) {
      showToast({
        title: "Gagal",
        message: error instanceof Error ? error.message : "Terjadi kesalahan.",
        type: "error",
      });
    } finally {
      setBusyYear(null);
    }
  }

  async function removeSong(year: number) {
    setBusyYear(year);
    try {
      const res = await mutate("DELETE", undefined, `?year=${year}`);
      if (!res.ok) throw new Error("Gagal menghapus lagu.");
      await refresh();
      setVolumeDrafts((drafts) => {
        const next = { ...drafts };
        delete next[year];
        return next;
      });
      showToast({
        title: "Lagu dihapus",
        message: `Edisi ${year} kembali memakai lagu bawaan.`,
        type: "success",
      });
    } catch (error) {
      showToast({
        title: "Gagal",
        message: error instanceof Error ? error.message : "Terjadi kesalahan.",
        type: "error",
      });
    } finally {
      setBusyYear(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Musik Ulang Tahun</h1>
        <p className="mt-2 text-sm text-[#fdf3d8]/70">
          Satu lagu per edisi. Lagu berbunyi otomatis saat pengunjung membuka kotak
          hadiah. Selama lagu belum <strong>ditayangkan</strong>, pengalaman publik
          tetap memakai lagu bawaan — jadi mengunggah file tidak langsung mengubah
          apa yang didengar pengunjung.
        </p>
      </div>

      {music === null ? (
        <p role="status" className="text-sm text-[#fdf3d8]/60">
          Memuat…
        </p>
      ) : (
        <ul className="space-y-3">
          {EDITIONS.map((edition) => {
            const entry = byYear.get(edition.year);
            const busy = busyYear === edition.year;
            const published = entry?.publishedAt != null && entry?.mediaId != null;

            return (
              <li
                key={edition.year}
                className="rounded-2xl border border-white/10 bg-[#0b1226]/70 p-5 backdrop-blur-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-[#f6d77a]">
                      Usia {edition.age} · {edition.year}
                    </p>
                    <h2 className="mt-1 font-medium text-[#fdf3d8]">{edition.title}</h2>
                    <p className="text-xs text-[#fdf3d8]/60">{edition.dateLabel}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.15em] ${
                      published
                        ? "border-[#7fe3a1]/40 bg-[#7fe3a1]/10 text-[#b6f5cd]"
                        : entry?.mediaId
                          ? "border-[#f6d77a]/40 bg-[#f6d77a]/10 text-[#f6d77a]"
                          : "border-white/15 bg-white/5 text-[#fdf3d8]/60"
                    }`}
                  >
                    {published ? "Tayang" : entry?.mediaId ? "Belum tayang" : "Lagu bawaan"}
                  </span>
                </div>

                <p className="mt-3 text-xs text-[#fdf3d8]/70">
                  {entry?.displayName ? (
                    <>
                      File: <span className="text-[#fdf3d8]">{entry.displayName}</span>
                    </>
                  ) : (
                    "Belum ada file lagu untuk edisi ini — pengalaman memakai lagu bawaan."
                  )}
                </p>

                {entry?.mediaId && (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <label
                      htmlFor={`music-volume-${edition.year}`}
                      className="text-xs text-[#fdf3d8]/70"
                    >
                      Volume:{" "}
                      {Math.round(
                        (volumeDrafts[edition.year] ?? entry.volume ?? MUSIC_VOLUME) * 100,
                      )}
                      %
                    </label>
                    <input
                      id={`music-volume-${edition.year}`}
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volumeDrafts[edition.year] ?? entry.volume ?? MUSIC_VOLUME}
                      disabled={busy}
                      onChange={(event) =>
                        setVolumeDrafts((drafts) => ({
                          ...drafts,
                          [edition.year]: Number(event.target.value),
                        }))
                      }
                      className="accent-[#e9c67c]"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveVolume(edition.year)}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#fdf3d8]/85 transition hover:border-white/45 disabled:opacity-50"
                    >
                      Simpan volume
                    </button>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    ref={(node) => {
                      fileInputs.current[edition.year] = node;
                    }}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadFor(edition.year, file);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileInputs.current[edition.year]?.click()}
                    className="rounded-full border border-[#e9c67c]/45 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#f6e3b2] transition hover:border-[#e9c67c] disabled:opacity-50"
                  >
                    {entry?.mediaId ? "Ganti lagu" : "Unggah lagu"}
                  </button>

                  {entry?.mediaId && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPublished(edition.year, !published)}
                        className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#fdf3d8]/85 transition hover:border-white/45 disabled:opacity-50"
                      >
                        {published ? "Tarik dari publik" : "Tayangkan"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeSong(edition.year)}
                        className="rounded-full border border-red-400/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-200/80 transition hover:border-red-400/60 disabled:opacity-50"
                      >
                        Hapus
                      </button>
                    </>
                  )}

                  {busy && <span className="text-xs text-[#fdf3d8]/60">Memproses…</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-[#fdf3d8]/50">
        Catatan: memasang lagu memerlukan tabel <code>birthday_music</code> (migrasi
        4G.46). Sebelum migrasi dijalankan, halaman ini menampilkan semua edisi
        sebagai “Lagu bawaan”.
      </p>
    </div>
  );
}
