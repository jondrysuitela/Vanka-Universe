"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_LETTER_DRAFT,
  EMPTY_LETTER_DRAFT,
  loadLetterForAge,
  saveLetterForAge,
  type LetterDraft,
} from "@/components/birthday/LetterScene";
import { useToast } from "@/components/admin/ui/ToastProvider";
import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";
import { cycleContainingUpload, isCycleRevealed } from "@/lib/birthday/cycle";
import { saveLetterEnsuringEdition } from "@/lib/birthday/letter-sync";
import { compressForUpload, describeSavings } from "@/lib/media/compress";
import ScrapbookImageCropper from "@/components/admin/media/ScrapbookImageCropper";

/**
 * Pustaka Media — upload photos/videos to the private local server store.
 *
 * No mock data. File type (magic bytes), size limits, authentication, and the
 * private (non-`public/`) store are unchanged. Uploads can carry an optional
 * Judul ("title") dan Keterangan ("description") which are stored with the
 * record; saved images in the birthday pool can be set as the opening
 * thumbnail of the birthday experience (written into the edition's browser
 * draft, then sent to the server from "Tulis Surat" when final).
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

/**
 * Edition (age) this photo belongs to: the birthday cycle its UPLOAD time falls
 * in — the same rule as the gallery. Unknown/out-of-registry cycles fall back to
 * the age-1 edition.
 */
function editionAgeFor(item: SavedMedia): number {
  return cycleContainingUpload(Date.parse(item.createdAt))?.age ?? 1;
}

/**
 * True when the photo's edition has already gone live: from the reveal instant
 * the edition is FROZEN, so its opening thumbnail can no longer change (the
 * server refuses the letter write). Falls back to `false` for an unknown cycle.
 */
function editionFrozen(item: SavedMedia): boolean {
  const cycle = cycleContainingUpload(Date.parse(item.createdAt));
  return cycle !== null && isCycleRevealed(cycle.year, new Date());
}

/**
 * "Jadikan Thumbnail" — make this image the opening frame of the birthday
 * experience. See `setThumbnail` for the two places the choice is written.
 *
 * Only IMAGES in the BIRTHDAY pool can be the opening thumbnail; Arsip Ibu media
 * is excluded, and an edition that has already gone live is frozen. The button
 * ASKS FOR CONFIRMATION first — the choice changes what every visitor sees.
 */
function ThumbnailButton({ item, onSet }: { item: SavedMedia; onSet: (item: SavedMedia) => void }) {
  if (item.kind !== "image" || item.collection === "archive") return null;
  const frozen = editionFrozen(item);
  return (
    <button
      type="button"
      onClick={() => onSet(item)}
      disabled={frozen}
      title={frozen ? "Edisi ini sudah tayang — thumbnail dibekukan." : undefined}
      className="inline-flex items-center gap-2 rounded-lg border border-[#f6d77a]/40 px-3 py-1.5 text-xs font-medium text-[#f6d77a] transition-colors hover:bg-[#f6d77a]/10 disabled:cursor-not-allowed disabled:opacity-45"
    >
      Jadikan Thumbnail
    </button>
  );
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
  uploadFile?: File;
  name: string;
  size: number;
  kind: MediaKind;
  url: string;
  uploadUrl?: string;
}

interface SavedMedia {
  id: string;
  name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  createdAt: string;
  collection?: "birthday" | "archive";
  title?: string | null;
  description?: string | null;
}

export default function AdminMediaPage() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Optional upload-time metadata (judul + keterangan).
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");

  const [saved, setSaved] = useState<SavedMedia[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { showToast } = useToast();

  // Keep the original and crop preview URLs alive independently.
  useEffect(() => {
    const url = selected?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected?.url]);

  useEffect(() => {
    const url = selected?.uploadUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selected?.uploadUrl]);

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
    setCropOpen(false);
  }

  function clearSelection() {
    setSelected(null);
    setCropOpen(false);
    setPickerError(null);
    setSaveError(null);
    setUploadTitle("");
    setUploadDescription("");
    setPickerOpen(false);
  }

  async function handleSave() {
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Shrink photos in the browser first: a camera-sized JPEG becomes a
      // modest, still-sharp file, so every grid that renders it stays light.
      // Videos and GIFs pass through unchanged (see `lib/media/compress.ts`).
      const shrunk = await compressForUpload(selected.uploadFile ?? selected.file, selected.kind);
      if (shrunk.file.size > MAX_IMAGE_BYTES && selected.kind === "image") {
        setSaveError("Ukuran foto hasil crop masih melebihi 10 MB.");
        return;
      }

      const form = new FormData();
      form.append("file", shrunk.file, shrunk.file.name);
      form.append("title", uploadTitle);
      form.append("description", uploadDescription);
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
      const savings = describeSavings(shrunk);
      showToast({
        title: "Tersimpan",
        message: savings
          ? `File tersimpan di penyimpanan aman (R2) · dikompres ${savings}.`
          : "File tersimpan di penyimpanan aman (R2).",
        type: "success",
      });
    } catch {
      setSaveError("Tidak dapat menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  function applyCrop(file: File) {
    setSelected((current) =>
      current
        ? { ...current, uploadFile: file, uploadUrl: URL.createObjectURL(file) }
        : current,
    );
    setCropOpen(false);
  }

  /** The photo awaiting confirmation, or null when no dialog is open. */
  const [thumbCandidate, setThumbCandidate] = useState<SavedMedia | null>(null);
  const [thumbSaving, setThumbSaving] = useState(false);

  /**
   * Ask before changing the opening frame — this is what every visitor sees on
   * the birthday page, so it is not a silent edit.
   */
  function requestThumbnail(item: SavedMedia) {
    if (editionFrozen(item)) {
      showToast({
        title: "Sudah tayang — dibekukan",
        message:
          "Edisi foto ini sudah lewat tanggal ulang tahunnya; bingkai pembukanya dibekukan dan tidak dapat diubah lagi.",
        type: "error",
      });
      return;
    }
    setThumbCandidate(item);
  }

  /**
   * Make the confirmed photo the opening frame of its birthday edition.
   *
   * It is written to TWO places, and both are required:
   *
   *  1. The BROWSER DRAFT (`localStorage`) — what the ADMIN preview reads. An
   *     admin must see their own unsaved choice immediately.
   *  2. The SERVER letter (`POST /api/birthday/letters`) — what the PUBLIC
   *     experience reads after the reveal. Without this the thumbnail only ever
   *     existed in one browser and never appeared on the published page, which
   *     is exactly the bug this fixes.
   *
   * The `src` is stored as the private `/api/media/[id]` URL. The public read
   * rewrites it to the date-gated gallery route (`letters/public-view.ts`), so
   * no private path is ever served to a visitor.
   */
  async function setThumbnail(item: SavedMedia) {
    const age = editionAgeFor(item);
    const thumbnail = {
      src: `/api/media/${item.id}`,
      alt: item.title?.trim() || item.name,
      ...(item.description?.trim() ? { caption: item.description.trim() } : {}),
    };

    const base: LetterDraft =
      loadLetterForAge(age) ?? (age === 1 ? DEFAULT_LETTER_DRAFT : EMPTY_LETTER_DRAFT);
    const draft: LetterDraft = { ...base, thumbnail };
    saveLetterForAge(age, draft);

    setThumbSaving(true);
    try {
      const outcome = await saveLetterEnsuringEdition(fetch, age, draft);
      if (outcome.status === "saved") {
        showToast({
          title: "Thumbnail diset",
          message: `Foto ini sekarang jadi bingkai pembuka ulang tahun ke-${age} dan sudah tersimpan di server.`,
          type: "success",
        });
      } else if (outcome.status === "published") {
        showToast({
          title: "Edisi sudah tayang",
          message:
            "Tersimpan di draf browser, tetapi server menolak karena edisi ini sudah tayang. Bingkai publik tidak berubah.",
          type: "error",
        });
      } else if (outcome.status === "validation") {
        showToast({
          title: "Input ditolak server",
          message: `Tersimpan di draf browser, tetapi server menolak: ${outcome.message}`,
          type: "error",
        });
      } else if (outcome.status === "unauthorized") {
        showToast({
          title: "Sesi berakhir",
          message: "Tersimpan di draf browser, tetapi server menolak: sesi admin tidak valid.",
          type: "error",
        });
      } else {
        showToast({
          title: "Belum tersimpan ke server",
          message:
            "Tersimpan di draf browser, tetapi server tidak dapat dihubungi. Coba lagi dari “Tulis Surat”.",
          type: "error",
        });
      }
    } finally {
      setThumbSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Pustaka Media</h1>
          <p className="text-sm text-[#fdf3d8]/70 mt-2">
            *(Penyimpanan privat (Vercel + Cloudflare R2) — berkas tidak pernah masuk `public/`)*
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
              ulang oleh server sebelum disimpan. Foto JPEG, PNG, dan WebP bisa di-crop ke rasio
              scrapbook 4:5 sebelum upload.
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
                      src={selected.uploadUrl ?? selected.url}
                      alt={`Pratinjau gambar ${selected.name}`}
                      className={`max-h-80 w-auto object-contain ${selected.uploadFile ? "aspect-[4/5]" : ""}`}
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

              {selected.kind === "image" && selected.file.type !== "image/gif" && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCropOpen(true)}
                    className="rounded-lg border border-[#f6d77a]/45 px-4 py-2 text-sm text-[#f6d77a] transition hover:bg-[#f6d77a]/10"
                  >
                    {selected.uploadFile ? "Atur ulang crop 4:5" : "Crop untuk scrapbook 4:5"}
                  </button>
                  {selected.uploadFile && (
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((current) =>
                          current ? { ...current, uploadFile: undefined, uploadUrl: undefined } : current,
                        )
                      }
                      className="text-sm text-[#fdf3d8]/65 underline underline-offset-4 hover:text-[#fdf3d8]"
                    >
                      Gunakan foto asli
                    </button>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-[#fdf3d8]/85 space-y-1">
                <p className="break-all">
                  <span className="text-[#fdf3d8]/60">Nama file:</span> {selected.name}
                </p>
                <p>
                  <span className="text-[#fdf3d8]/60">Ukuran:</span>{" "}
                  {formatBytes(selected.uploadFile?.size ?? selected.size)}
                </p>
                <p>
                  <span className="text-[#fdf3d8]/60">Jenis:</span>{" "}
                  {selected.kind === "image" ? "Gambar" : "Video"}
                </p>
                <p className="pt-1 font-medium text-[#f6d77a]">
                  {selected.uploadFile
                    ? "Hasil crop 4:5 siap diupload. Foto asli di perangkat tidak diubah."
                    : "Pratinjau sementara — belum tersimpan"}
                </p>
              </div>

              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[#fdf3d8]/70">Judul (opsional)</span>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                    maxLength={200}
                    placeholder="Mis. Senyum pertama Vanka"
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-[#fdf3d8] placeholder:text-[#fdf3d8]/40 focus:border-[#f6d77a]/60 focus:outline-none"
                    aria-label="Judul media"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[#fdf3d8]/70">Keterangan (opsional)</span>
                  <textarea
                    value={uploadDescription}
                    onChange={(event) => setUploadDescription(event.target.value)}
                    maxLength={5000}
                    rows={3}
                    placeholder="Cerita singkat di balik foto atau video ini…"
                    className="w-full resize-y rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-[#fdf3d8] placeholder:text-[#fdf3d8]/40 focus:border-[#f6d77a]/60 focus:outline-none"
                    aria-label="Keterangan media"
                  />
                </label>
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
                    // cookie through the optimizer, so <img> is used. The card
                    // decodes/renders at its own size (no `sizes`-less full
                    // resolution paint) and is lazy so a long library does not
                    // download everything at once.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${item.id}`}
                      alt={item.title?.trim() || item.name}
                      loading="lazy"
                      decoding="async"
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
                  <h3 className="text-sm font-medium text-[#fdf3d8] break-all">
                    {item.title?.trim() || item.name}
                  </h3>
                  {item.title?.trim() && item.name !== item.title?.trim() && (
                    <p className="text-xs text-[#fdf3d8]/50 break-all">{item.name}</p>
                  )}
                  {item.description?.trim() && (
                    <p className="text-xs text-[#fdf3d8]/75 leading-relaxed break-words">
                      {item.description.trim()}
                    </p>
                  )}
                  <p className="text-xs text-[#fdf3d8]/60">
                    {item.kind === "image" ? "Gambar" : "Video"} · {formatBytes(item.size)}
                  </p>
                  <p className="text-xs text-emerald-300/80">
                    Tersimpan aman (R2) · Pool{" "}
                    {item.collection === "archive" ? "Arsip Ibu" : "Ulang Tahun"}
                  </p>
                  <div className="pt-2">
                    <ThumbnailButton item={item} onSet={requestThumbnail} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {cropOpen && selected?.kind === "image" && selected.file.type !== "image/gif" && (
        <ScrapbookImageCropper
          file={selected.file}
          onCancel={() => setCropOpen(false)}
          onApply={applyCrop}
        />
      )}

      <ConfirmDialog
        open={thumbCandidate !== null}
        title="Jadikan foto ini thumbnail?"
        description={
          thumbCandidate
            ? `"${thumbCandidate.title?.trim() || thumbCandidate.name}" akan menjadi bingkai pembuka ulang tahun ke-${editionAgeFor(
                thumbCandidate,
              )} dan langsung tersimpan, sehingga pengunjung melihatnya di halaman Vanka's First Universe.`
            : undefined
        }
        confirmLabel={thumbSaving ? "Menyimpan…" : "Ya, jadikan thumbnail"}
        cancelLabel="Batal"
        onConfirm={() => {
          const item = thumbCandidate;
          if (!item || thumbSaving) return;
          setThumbCandidate(null);
          void setThumbnail(item);
        }}
        onCancel={() => {
          if (!thumbSaving) setThumbCandidate(null);
        }}
      />
    </div>
  );
}
