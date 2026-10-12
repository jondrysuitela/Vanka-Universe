"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/admin/ui/ToastProvider";

/**
 * Pustaka Media — upload photos/videos to the private local server store.
 *
 * No mock data. File type (magic bytes), size limits, authentication, and the
 * private (non-`public/`) store are unchanged. Metadata edit and delete are NOT
 * supported by the current API, so they are not shown here.
 */

type MediaKind = "image" | "video";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Client-side pre-checks — an early convenience filter, NOT a security
 * boundary. The server re-validates the real type via magic bytes and the
 * size before storing anything.
 */
const ALLOWED_TYPES: ReadonlyArray<{ mime: string; exts: string[]; kind: MediaKind }> = [
  { mime: "image/jpeg", exts: ["jpg", "jpeg"], kind: "image" },
  { mime: "image/png", exts: ["png"], kind: "image" },
  { mime: "image/webp", exts: ["webp"], kind: "image" },
  { mime: "image/gif", exts: ["gif"], kind: "image" },
  { mime: "video/mp4", exts: ["mp4"], kind: "video" },
];

const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.mp4,image/jpeg,image/png,image/webp,image/gif,video/mp4";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): { kind: MediaKind } | { error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const entry = ALLOWED_TYPES.find((t) => t.mime === file.type && t.exts.includes(ext));
  if (!entry) {
    return {
      error: "Tipe file tidak didukung. Gunakan gambar JPEG, PNG, WebP, GIF, atau video MP4.",
    };
  }
  const limit = entry.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (file.size > limit) {
    return {
      error: `Ukuran file terlalu besar (${formatBytes(file.size)}). Maksimal ${
        entry.kind === "image" ? "10 MB untuk gambar" : "50 MB untuk video"
      }.`,
    };
  }
  return { kind: entry.kind };
}

interface SelectedFile {
  file: File;
  name: string;
  size: number;
  kind: MediaKind;
  url: string;
}

interface SavedMedia {
  id: string;
  name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  createdAt: string;
}

export default function AdminMediaPage() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const [saved, setSaved] = useState<SavedMedia[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { showToast } = useToast();

  // Release the previous object URL whenever the selection changes or unmounts.
  useEffect(() => {
    const url = selected?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected]);

  // Load already-stored media (private endpoint; needs an admin session).
  useEffect(() => {
    let active = true;
    fetch("/api/media")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: SavedMedia[] }) => {
        if (active && Array.isArray(body.data)) setSaved(body.data);
      })
      .catch(() => {
        if (active) setListError("Masuk sebagai admin untuk melihat media tersimpan.");
      });
    return () => {
      active = false;
    };
  }, []);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file name/content later.
    event.target.value = "";
    if (!file) return;

    const result = validateFile(file);
    if ("error" in result) {
      setPickerError(result.error);
      return;
    }

    setPickerError(null);
    setSaveError(null);
    // Local-only preview until the user explicitly saves.
    setSelected({
      file,
      name: file.name,
      size: file.size,
      kind: result.kind,
      url: URL.createObjectURL(file),
    });
  }

  function clearSelection() {
    setSelected(null);
    setPickerError(null);
    setSaveError(null);
    setPickerOpen(false);
  }

  async function handleSave() {
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const form = new FormData();
      form.append("file", selected.file, selected.name);
      const res = await fetch("/api/media", {
        method: "POST",
        headers: { "x-vanka-request": "1" },
        body: form,
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: SavedMedia; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.data) {
        setSaveError(body?.error?.message ?? "Gagal menyimpan file ke server.");
        return;
      }
      setSaved((prev) => [body.data as SavedMedia, ...prev]);
      clearSelection();
      showToast({
        title: "Tersimpan",
        message: "File tersimpan di penyimpanan aman (R2).",
        type: "success",
      });
    } catch {
      setSaveError("Tidak dapat menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Pustaka Media</h1>
          <p className="text-sm text-[#fdf3d8]/70 mt-2">
            *(Penyimpanan privat (Cloudflare R2) — berkas tidak pernah masuk `public/`)*
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-5 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
          onClick={() => {
            setPickerOpen((open) => !open);
          }}
        >
          {pickerOpen ? "Tutup Pemilih File" : "Tambah Media"}
        </button>
      </div>

      {pickerOpen && (
        <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-display tracking-wider text-[#fdf3d8]">Pilih File Media</h2>
            <p className="text-xs text-[#fdf3d8]/60">
              Gambar (JPEG, PNG, WebP, GIF) maks 10 MB · Video MP4 maks 50 MB. Tipe nyata diperiksa
              ulang oleh server sebelum disimpan.
            </p>
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 px-4 py-6 text-sm text-[#fdf3d8]/80 transition-colors hover:border-[#f6d77a]/60 hover:text-[#fdf3d8] focus-within:border-[#f6d77a]/60">
            <span>Klik untuk memilih file dari perangkat…</span>
            <input
              type="file"
              accept={ACCEPT}
              onChange={handleFileChange}
              className="sr-only"
              aria-label="Pilih file media"
            />
          </label>

          {pickerError && (
            <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {pickerError}
            </p>
          )}

          {selected ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <div className="flex items-center justify-center">
                  {selected.kind === "image" ? (
                    // Blob object URL: next/image cannot optimize it, so a plain
                    // <img> is used deliberately for the local preview.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.url}
                      alt={`Pratinjau gambar ${selected.name}`}
                      className="max-h-80 w-auto object-contain"
                    />
                  ) : (
                    <video
                      src={selected.url}
                      controls
                      preload="metadata"
                      aria-label={`Pratinjau video ${selected.name}`}
                      className="max-h-80 w-full object-contain"
                    />
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-[#fdf3d8]/85 space-y-1">
                <p className="break-all">
                  <span className="text-[#fdf3d8]/60">Nama file:</span> {selected.name}
                </p>
                <p>
                  <span className="text-[#fdf3d8]/60">Ukuran:</span> {formatBytes(selected.size)}
                </p>
                <p>
                  <span className="text-[#fdf3d8]/60">Jenis:</span>{" "}
                  {selected.kind === "image" ? "Gambar" : "Video"}
                </p>
                <p className="pt-1 font-medium text-[#f6d77a]">
                  Pratinjau sementara — belum tersimpan
                </p>
              </div>

              {saveError && (
                <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {saveError}
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-6 py-2.5 text-sm font-semibold text-[#050814] transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6d77a] disabled:opacity-50"
                >
                  {saving ? "Menyimpan…" : "Simpan ke Server"}
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#f6d77a]">
                  Ganti File
                  <input
                    type="file"
                    accept={ACCEPT}
                    onChange={handleFileChange}
                    className="sr-only"
                    aria-label="Ganti file media"
                  />
                </label>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6d77a]"
                >
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6d77a]"
            >
              Batal
            </button>
          )}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-display tracking-wider text-[#fdf3d8]">
          Media Tersimpan
        </h2>
        {listError ? (
          <p className="rounded-2xl border border-white/10 bg-[#0b1226]/70 px-6 py-4 text-sm text-[#fdf3d8]/70 backdrop-blur-xl">
            {listError}
          </p>
        ) : saved.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-[#0b1226]/70 px-6 py-4 text-sm text-[#fdf3d8]/70 backdrop-blur-xl">
            Belum ada media tersimpan.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl overflow-hidden"
              >
                <div className="aspect-video bg-black/40 flex items-center justify-center">
                  {item.kind === "image" ? (
                    // Private endpoint; next/image cannot attach the session
                    // cookie through the optimizer, so <img> is used.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${item.id}`}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video
                      src={`/api/media/${item.id}`}
                      controls
                      preload="metadata"
                      aria-label={item.name}
                      className="h-full w-full object-contain"
                    />
                  )}
                </div>
                <div className="p-4 space-y-1">
                  <h3 className="text-sm font-medium text-[#fdf3d8] break-all">{item.name}</h3>
                  <p className="text-xs text-[#fdf3d8]/60">
                    {item.kind === "image" ? "Gambar" : "Video"} · {formatBytes(item.size)}
                  </p>
                  <p className="text-xs text-emerald-300/80">Tersimpan aman (R2)</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
