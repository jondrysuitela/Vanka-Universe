"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";
import { useToast } from "@/components/admin/ui/ToastProvider";
import { compressForUpload, describeSavings } from "@/lib/media/compress";
import ScrapbookImageCropper from "@/components/admin/media/ScrapbookImageCropper";
import {
  EMPTY_GALLERY_STATE,
  addVideo,
  addPhoto,
  fromServerGallery,
  galleryLoadNote,
  gallerySaveMessage,
  galleryStatesEqual,
  isMediaUsed,
  loadGallery,
  loadMediaFiles,
  movePhoto,
  moveVideo,
  removePhoto,
  removeVideo,
  setIntro,
  splitMedia,
  updatePhoto,
  updateVideo,
  saveGallery,
  type GalleryState,
  type MediaFile,
  type ServerGallery,
} from "@/lib/archive/gallery-sync";

/**
 * Admin gallery editor for the private archive ("Arsip Ibu") — Tahap 4G.39B.
 *
 * HONEST STATE:
 * - Loads the real media library (`GET /api/media`) and the saved gallery
 *   (`GET /api/archive/gallery`). Nothing is fabricated.
 * - `localStorage` is NEVER the source of truth; edits live in React state and
 *   reach the server only through the explicit "Simpan ke Server" button.
 * - A 503 (draft migration not applied) is shown as "not activated", never as an
 *   empty saved gallery. Failed saves keep the in-memory edits intact.
 * - Removing a gallery item removes only its reference; the source media file
 *   is never deleted here.
 */

type LoadState =
  | { status: "loading" }
  | { status: "ok"; gallery: ServerGallery }
  | { status: "not_migrated" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

type MediaState =
  | { status: "loading"; files: MediaFile[] }
  | { status: "ok"; files: MediaFile[] }
  | { status: "unauthorized"; files: MediaFile[] }
  | { status: "unavailable"; files: MediaFile[] };

/* ---------------------------------------------------------------------------
 * Arsip-ibu upload (Tahap 4G.42B). Uploads here are tagged `collection=archive`
 * so they land in the private archive pool — they never auto-join the birthday
 * gallery, which only contains `collection='birthday'` media.
 * ------------------------------------------------------------------------- */

type UploadKind = "image" | "video";

const UPLOAD_ALLOWED: ReadonlyArray<{ mime: string; exts: string[]; kind: UploadKind }> = [
  { mime: "image/jpeg", exts: ["jpg", "jpeg"], kind: "image" },
  { mime: "image/png", exts: ["png"], kind: "image" },
  { mime: "image/webp", exts: ["webp"], kind: "image" },
  { mime: "image/gif", exts: ["gif"], kind: "image" },
  { mime: "video/mp4", exts: ["mp4"], kind: "video" },
];

const UPLOAD_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.gif,.mp4,image/jpeg,image/png,image/webp,image/gif,video/mp4";

const UPLOAD_MAX_IMAGE = 10 * 1024 * 1024;
const UPLOAD_MAX_VIDEO = 50 * 1024 * 1024;

function uploadFormatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Early client-side filter only; the server re-validates magic bytes/size. */
function validateUploadFile(file: File): { kind: UploadKind } | { error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const entry = UPLOAD_ALLOWED.find((t) => t.mime === file.type && t.exts.includes(ext));
  if (!entry) {
    return {
      error: "Tipe file tidak didukung. Gunakan gambar JPEG, PNG, WebP, GIF, atau video MP4.",
    };
  }
  const limit = entry.kind === "image" ? UPLOAD_MAX_IMAGE : UPLOAD_MAX_VIDEO;
  if (file.size > limit) {
    return {
      error: `Ukuran file terlalu besar (${uploadFormatBytes(file.size)}). Maksimal ${
        entry.kind === "image" ? "10 MB untuk gambar" : "50 MB untuk video"
      }.`,
    };
  }
  return { kind: entry.kind };
}

interface SelectedUpload {
  file: File;
  uploadFile?: File;
  name: string;
  size: number;
  kind: UploadKind;
  url: string;
  uploadUrl?: string;
}

interface DirectUploadPlanResponse {
  id: string;
  url: string;
  headers: Record<string, string>;
}

function isDirectUploadPlan(value: unknown): value is DirectUploadPlanResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.id === "string" &&
    typeof plan.url === "string" &&
    typeof plan.headers === "object" &&
    plan.headers !== null &&
    !Array.isArray(plan.headers) &&
    Object.values(plan.headers).every((header) => typeof header === "string")
  );
}

export default function AdminArchiveGallery() {
  const { showToast } = useToast();

  const [mediaState, setMediaState] = useState<MediaState>({ status: "loading", files: [] });
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [gallery, setGallery] = useState<GalleryState>(EMPTY_GALLERY_STATE);
  const [baseline, setBaseline] = useState<GalleryState>(EMPTY_GALLERY_STATE);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);

  // Arsip-ibu upload widget state.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSelected, setUploadSelected] = useState<SelectedUpload | null>(null);
  const [uploadCropOpen, setUploadCropOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const dirty = !galleryStatesEqual(gallery, baseline);

  // Keep original and cropped preview URLs alive independently.
  useEffect(() => {
    const url = uploadSelected?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [uploadSelected?.url]);

  useEffect(() => {
    const url = uploadSelected?.uploadUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [uploadSelected?.uploadUrl]);

  // Initial load: media library + saved gallery. Never overwrites local edits
  // (this only runs on mount, before any edit exists).
  useEffect(() => {
    let active = true;
    void (async () => {
      const [media, saved] = await Promise.all([loadMediaFiles(fetch), loadGallery(fetch)]);
      if (!active) return;

      if (media.status === "ok") setMediaState({ status: "ok", files: media.files });
      else setMediaState({ status: media.status, files: [] });

      if (saved.status === "ok") {
        setLoadState({ status: "ok", gallery: saved.gallery });
        const state = fromServerGallery(saved.gallery);
        setGallery(state);
        setBaseline(state);
      } else {
        setLoadState({ status: saved.status });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function applyServer(saved: ServerGallery) {
    setLoadState({ status: "ok", gallery: saved });
    const state = fromServerGallery(saved);
    setGallery(state);
    setBaseline(state);
  }

  async function reloadFromServer() {
    setConfirmReload(false);
    const result = await loadGallery(fetch);
    if (result.status === "ok") {
      applyServer(result.gallery);
      showToast({ title: "Dimuat dari server", message: "Galeri tersimpan dimuat ulang.", type: "info" });
    } else {
      setLoadState({ status: result.status });
      showToast(galleryLoadNote(result.status));
    }
  }

  /** Reload the media library (used after an archive upload). Never fakes data. */
  async function refreshMedia() {
    const media = await loadMediaFiles(fetch);
    setMediaState(
      media.status === "ok"
        ? { status: "ok", files: media.files }
        : { status: media.status, files: [] },
    );
  }

  function clearUploadSelection() {
    setUploadSelected(null);
    setUploadCropOpen(false);
    setUploadError(null);
    setUploadOpen(false);
  }

  function handleUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file name/content later.
    event.target.value = "";
    if (!file) return;

    const result = validateUploadFile(file);
    if ("error" in result) {
      setUploadError(result.error);
      return;
    }
    setUploadError(null);
    setUploadSelected({
      file,
      name: file.name,
      size: file.size,
      kind: result.kind,
      url: URL.createObjectURL(file),
    });
    setUploadCropOpen(false);
  }

  function applyUploadCrop(file: File) {
    setUploadSelected((current) =>
      current
        ? { ...current, uploadFile: file, uploadUrl: URL.createObjectURL(file) }
        : current,
    );
    setUploadCropOpen(false);
  }

  async function handleUploadSave() {
    if (!uploadSelected || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      // Shrink photos in the browser first (videos and GIFs pass through), so
      // the archive renders modest files instead of camera-sized originals.
      const shrunk = await compressForUpload(
        uploadSelected.uploadFile ?? uploadSelected.file,
        uploadSelected.kind,
      );
      if (shrunk.file.size > UPLOAD_MAX_IMAGE && uploadSelected.kind === "image") {
        setUploadError("Ukuran foto hasil crop masih melebihi 10 MB.");
        return;
      }

      const initResponse = await fetch("/api/media/direct-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({
          action: "create",
          name: shrunk.file.name,
          mime: shrunk.file.type,
          size: shrunk.file.size,
        }),
      });
      const initBody = (await initResponse.json().catch(() => null)) as
        | { data?: unknown; error?: { message?: string } }
        | null;
      if (!initResponse.ok || !initBody?.data) {
        const responseType = initResponse.headers.get("content-type");
        const responseInfo = [
          `HTTP ${initResponse.status}`,
          responseType ? `respons ${responseType.split(";")[0]}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        setUploadError(
          initBody?.error?.message ??
            `Server gagal menyiapkan unggahan (${responseInfo}). Coba lagi; bila berulang, kirim kode HTTP ini untuk diperiksa.`,
        );
        return;
      }
      if (!isDirectUploadPlan(initBody.data)) {
        setUploadError("Server mengirim instruksi unggah yang tidak valid.");
        return;
      }

      const objectResponse = await fetch(initBody.data.url, {
        method: "PUT",
        headers: initBody.data.headers,
        body: shrunk.file,
      });
      if (!objectResponse.ok) {
        const responseType = objectResponse.headers.get("content-type");
        setUploadError(
          `Gagal mengunggah ke penyimpanan (HTTP ${objectResponse.status}${
            responseType ? ` · respons ${responseType.split(";")[0]}` : ""
          }). Coba lagi; bila berulang, kirim kode HTTP ini untuk diperiksa.`,
        );
        return;
      }

      const completeResponse = await fetch("/api/media/direct-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({ action: "complete", id: initBody.data.id }),
      });
      const completeBody = (await completeResponse.json().catch(() => null)) as
        | { data?: unknown; error?: { message?: string } }
        | null;
      if (!completeResponse.ok || !completeBody?.data) {
        const responseType = completeResponse.headers.get("content-type");
        const responseInfo = [
          `HTTP ${completeResponse.status}`,
          responseType ? `respons ${responseType.split(";")[0]}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        setUploadError(
          completeBody?.error?.message ??
            `Server gagal memverifikasi unggahan (${responseInfo}). Coba lagi; bila berulang, kirim kode HTTP ini untuk diperiksa.`,
        );
        return;
      }
      clearUploadSelection();
      const savings = describeSavings(shrunk);
      showToast({
        title: "File tersimpan",
        message: savings
          ? `File tersimpan di server (dikompres ${savings}). Tambahkan ke susunan galeri lalu simpan galeri untuk menampilkannya.`
          : "File tersimpan di server. Tambahkan ke susunan galeri lalu simpan galeri untuk menampilkannya.",
        type: "success",
      });
      await refreshMedia();
    } catch {
      setUploadError("Koneksi ke server atau R2 gagal. Periksa koneksi dan CORS bucket R2.");
    } finally {
      setUploading(false);
    }
  }

  function requestReload() {
    if (dirty) setConfirmReload(true);
    else void reloadFromServer();
  }

  function handleAddPhoto(media: MediaFile) {
    const result = addPhoto(gallery, media.id);
    if (!result.ok) {
      showToast({ title: "Sudah dipakai", message: "Media ini sudah ada di galeri.", type: "info" });
      return;
    }
    setGallery(result.state);
  }

  function handleAddVideo(media: MediaFile) {
    const result = addVideo(gallery, media.id);
    if (!result.ok) {
      showToast({ title: "Sudah dipakai", message: "Media ini sudah ada di arsip.", type: "info" });
      return;
    }
    setGallery(result.state);
  }

  function handleSetIntro(mediaId: string | null) {
    const result = setIntro(gallery, mediaId);
    if (!result.ok) {
      showToast({
        title: "Tidak bisa",
        message: "Media ini sudah dipakai sebagai video pembuka atau item galeri.",
        type: "info",
      });
      return;
    }
    setGallery(result.state);
  }

  function confirmRemove() {
    if (pendingRemove) {
      setGallery(removeVideo(removePhoto(gallery, pendingRemove), pendingRemove));
      setPendingRemove(null);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      // Edits stay in memory on failure; only a confirmed success re-syncs.
      const result = await saveGallery(fetch, gallery);
      if (result.status === "saved") applyServer(result.gallery);
      showToast(gallerySaveMessage(result));
    } finally {
      setSaving(false);
    }
  }

  const { videos, images } = splitMedia(mediaState.files);
  const introMedia = gallery.introMediaId
    ? mediaState.files.find((f) => f.id === gallery.introMediaId) ?? null
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-display tracking-wider text-[#fdf3d8]">Galeri Arsip Ibu</h2>
          <p className="text-sm text-[#fdf3d8]/70 mt-1">
            Video pembuka, video kenangan, dan foto. Berkas yang diunggah langsung tersimpan di
            server; susunan galeri tersimpan setelah menekan “Simpan ke Server”.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              clearUploadSelection();
              setUploadOpen((open) => !open);
            }}
            className="rounded-lg bg-gradient-to-r from-[#a8e6cf] to-[#d8f3e4] text-[#050814] px-5 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
          >
            {uploadOpen ? "Tutup Upload" : "Tambah Media Arsip"}
          </button>
          <button
            type="button"
            onClick={requestReload}
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5"
          >
            Muat ulang dari server
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-5 py-2.5 text-sm font-medium hover:opacity-95 disabled:opacity-45"
          >
            {saving ? "Menyimpan…" : "Simpan ke Server"}
          </button>
        </div>
      </div>

      {dirty && (
        <p role="status" className="rounded-lg border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
          Ada perubahan belum tersimpan. Perubahan ini hanya ada di layar ini sampai Anda menekan
          “Simpan ke Server”.
        </p>
      )}

      {loadState.status !== "ok" && (
        <p
          role="status"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-xs text-[#fdf3d8]/80"
        >
          {loadState.status === "loading"
            ? "Memuat galeri tersimpan…"
            : galleryLoadNote(loadState.status).message}
        </p>
      )}

      {/* ------------------------------------------------ arsip-ibu upload */}
      {uploadOpen && (
        <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg text-[#fdf3d8]">Upload Media Arsip</h3>
            <p className="text-xs text-[#fdf3d8]/60">
              File ini masuk pool <span className="text-[#a8e6cf]">Arsip Ibu</span> — tidak pernah
              otomatis muncul di galeri pengalaman ulang tahun. Gambar (JPEG/PNG/WebP/GIF) maks 10
              MB · Video MP4 maks 50 MB. Foto JPEG, PNG, dan WebP bisa di-crop ke rasio scrapbook
              4:5 sebelum upload.
            </p>
          </div>

          <label className="flex w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-white/20 px-4 py-6 text-sm text-[#fdf3d8]/80 transition-colors hover:border-[#a8e6cf]/60 hover:text-[#fdf3d8] focus-within:border-[#a8e6cf]/60">
            <span>Klik untuk memilih file dari perangkat…</span>
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              onChange={handleUploadFileChange}
              className="sr-only"
              aria-label="Pilih file media arsip"
            />
          </label>

          {uploadError && (
            <p
              role="alert"
              className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {uploadError}
            </p>
          )}

          {uploadSelected ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <div className="flex items-center justify-center">
                  {uploadSelected.kind === "image" ? (
                    // Blob object URL: next/image cannot optimize it, so a plain
                    // <img> is used deliberately for the local preview.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={uploadSelected.uploadUrl ?? uploadSelected.url}
                      alt={`Pratinjau gambar ${uploadSelected.name}`}
                      decoding="async"
                      className={`max-h-80 w-auto object-contain ${uploadSelected.uploadFile ? "aspect-[4/5]" : ""}`}
                    />
                  ) : (
                    <video
                      src={uploadSelected.url}
                      controls
                      preload="metadata"
                      aria-label={`Pratinjau video ${uploadSelected.name}`}
                      className="max-h-80 w-full object-contain"
                    />
                  )}
                </div>
              </div>

              {uploadSelected.kind === "image" && uploadSelected.file.type !== "image/gif" && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setUploadCropOpen(true)}
                    className="rounded-lg border border-[#a8e6cf]/45 px-4 py-2 text-sm text-[#a8e6cf] transition hover:bg-[#a8e6cf]/10"
                  >
                    {uploadSelected.uploadFile ? "Atur ulang crop 4:5" : "Crop foto 4:5"}
                  </button>
                  {uploadSelected.uploadFile && (
                    <button
                      type="button"
                      onClick={() =>
                        setUploadSelected((current) =>
                          current
                            ? { ...current, uploadFile: undefined, uploadUrl: undefined }
                            : current,
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
                  <span className="text-[#fdf3d8]/60">Nama file:</span> {uploadSelected.name}
                </p>
                <p>
                  <span className="text-[#fdf3d8]/60">Ukuran:</span>{" "}
                  {uploadFormatBytes(uploadSelected.uploadFile?.size ?? uploadSelected.size)}
                </p>
                <p className="pt-1 font-medium text-[#a8e6cf]">
                  {uploadSelected.uploadFile
                    ? "Hasil crop 4:5 siap diupload. Foto asli di perangkat tidak diubah."
                    : "File siap diunggah ke server dan masuk ke Pustaka Arsip Privat."}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleUploadSave}
                  disabled={uploading}
                  className="rounded-lg bg-gradient-to-r from-[#a8e6cf] to-[#d8f3e4] px-6 py-2.5 text-sm font-semibold text-[#050814] transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#a8e6cf] disabled:opacity-50"
                >
                  {uploading ? "Menyimpan…" : "Simpan ke Server"}
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#a8e6cf]">
                  Ganti File
                  <input
                    type="file"
                    accept={UPLOAD_ACCEPT}
                    onChange={handleUploadFileChange}
                    className="sr-only"
                    aria-label="Ganti file media arsip"
                  />
                </label>
                <button
                  type="button"
                  onClick={clearUploadSelection}
                  className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6d77a]"
                >
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={clearUploadSelection}
              className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f6d77a]"
            >
              Batal
            </button>
          )}
        </section>
      )}

      {uploadCropOpen &&
        uploadSelected?.kind === "image" &&
        uploadSelected.file.type !== "image/gif" && (
          <ScrapbookImageCropper
            file={uploadSelected.file}
            onCancel={() => setUploadCropOpen(false)}
            onApply={applyUploadCrop}
          />
        )}

      {/* ---------------------------------------------------- media library */}
      {mediaState.status !== "ok" && (
        <p role="status" className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#fdf3d8]/70">
          {mediaState.status === "loading"
            ? "Memuat pustaka media…"
            : mediaState.status === "unauthorized"
              ? "Sesi/izin tidak mencukupi untuk memuat pustaka media."
              : "Pustaka media tidak dapat dimuat. Galeri tidak menampilkan contoh palsu."}
        </p>
      )}

      {/* ------------------------------------------------------ intro video */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <h3 className="font-display text-lg text-[#fdf3d8]">Video Pembuka</h3>

        {introMedia ? (
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden bg-black/40">
              <video
                src={`/api/media/${introMedia.id}`}
                controls
                preload="metadata"
                aria-label={`Video pembuka: ${introMedia.name}`}
                className="max-h-72 w-full object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-[#fdf3d8]/85">
              <span className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                Video pembuka terpilih
              </span>
              <span className="break-all">{introMedia.name}</span>
              <button
                type="button"
                onClick={() => handleSetIntro(null)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#fdf3d8]/90 hover:bg-white/5"
              >
                Hapus video pembuka
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#fdf3d8]/70">
            Belum ada video pembuka dipilih. Bila dibiarkan kosong, pengalaman akan langsung ke
            galeri.
          </p>
        )}

        {videos.length === 0 ? (
          <p className="text-xs text-[#fdf3d8]/60">
            Belum ada video tersimpan. Unggah video MP4 lewat tombol{" "}
            <span className="text-[#a8e6cf]">Tambah Media Arsip</span> di halaman ini, atau lewat{" "}
            <Link href="/admin/media" className="underline hover:text-[#f6d77a]">
              Pustaka Media
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {videos.map((video) => (
              <li
                key={video.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5"
              >
                <span className="truncate text-sm text-[#fdf3d8]/85" title={video.name}>
                  {video.name}
                </span>
                <button
                  type="button"
                  disabled={gallery.introMediaId === video.id}
                  onClick={() => handleSetIntro(video.id)}
                  className="shrink-0 rounded-lg border border-[#f6d77a]/40 px-3 py-1.5 text-xs text-[#f6d77a] hover:bg-[#f6d77a]/10 disabled:opacity-45"
                >
                  {gallery.introMediaId === video.id ? "Terpilih" : "Jadikan pembuka"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- video picker */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <h3 className="font-display text-lg text-[#fdf3d8]">Tambah Video Kenangan</h3>
        {videos.length === 0 ? (
          <p className="text-sm text-[#fdf3d8]/70">
            Belum ada video di server. Unggah video MP4 untuk menambahkannya ke galeri.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {videos.map((video) => {
              const used = isMediaUsed(gallery, video.id);
              return (
                <li key={video.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
                  <video
                    src={`/api/media/${video.id}`}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`Pratinjau ${video.name}`}
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <div className="flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0 truncate text-sm text-[#fdf3d8]/85" title={video.name}>
                      {video.name}
                    </span>
                    <button
                      type="button"
                      disabled={used}
                      onClick={() => handleAddVideo(video)}
                      className="shrink-0 rounded-lg border border-[#f6d77a]/40 px-3 py-1.5 text-xs text-[#f6d77a] hover:bg-[#f6d77a]/10 disabled:opacity-45"
                    >
                      {used ? "Sudah dipakai" : "Tambah ke galeri"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- photo picker */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <h3 className="font-display text-lg text-[#fdf3d8]">Tambah Foto ke Galeri</h3>
        {images.length === 0 ? (
          <p className="text-xs text-[#fdf3d8]/60">
            Belum ada foto tersimpan. Unggah foto lewat tombol{" "}
            <span className="text-[#a8e6cf]">Tambah Media Arsip</span> di halaman ini, atau lewat{" "}
            <Link href="/admin/media" className="underline hover:text-[#f6d77a]">
              Pustaka Media
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => {
              const used = isMediaUsed(gallery, image.id);
              return (
                <li
                  key={image.id}
                  className="rounded-xl border border-white/10 bg-white/5 overflow-hidden"
                >
                  <div className="aspect-square bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${image.id}`}
                      alt={image.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-2 space-y-2">
                    <p className="truncate text-xs text-[#fdf3d8]/80" title={image.name}>
                      {image.name}
                    </p>
                    <button
                      type="button"
                      disabled={used}
                      onClick={() => handleAddPhoto(image)}
                      className="w-full rounded-lg border border-[#f6d77a]/40 px-2 py-1.5 text-xs text-[#f6d77a] hover:bg-[#f6d77a]/10 disabled:opacity-45"
                    >
                      {used ? "Sudah dipakai" : "Tambah"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- gallery list */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg text-[#fdf3d8]">
            Galeri Video ({gallery.videos.length}) · Foto ({gallery.photos.length})
          </h3>
          {gallery.videos.length > 0 && (
            <p className="text-xs text-[#fdf3d8]/60">
              Urutan video: {gallery.videos.map((_, i) => `${i + 1}`).join(" · ")}
            </p>
          )}
        </div>

        {gallery.videos.length === 0 && gallery.photos.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#fdf3d8]/70">
            Belum ada video atau foto di galeri.
          </p>
        ) : (
          <>
          {gallery.videos.length > 0 && (
            <ol className="grid gap-5 sm:grid-cols-2">
              {gallery.videos.map((video, index) => {
                const media = mediaState.files.find((file) => file.id === video.mediaId);
                return (
                  <li key={video.mediaId} className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1226]/80">
                    <video
                      src={`/api/media/${video.mediaId}`}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={video.title || media?.name || "Video kenangan"}
                      className="aspect-video w-full bg-black object-contain"
                    />
                    <div className="space-y-3 p-4">
                      <p className="truncate text-xs text-[#fdf3d8]/55" title={media?.name}>{media?.name}</p>
                      <input
                        value={video.title}
                        onChange={(event) => setGallery(updateVideo(gallery, video.mediaId, { title: event.target.value }))}
                        placeholder="Judul video"
                        maxLength={255}
                        className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-[#f8fafc] placeholder:text-white/40"
                      />
                      <textarea
                        value={video.description}
                        onChange={(event) => setGallery(updateVideo(gallery, video.mediaId, { description: event.target.value }))}
                        placeholder="Cerita video ini…"
                        rows={2}
                        className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-[#f8fafc] placeholder:text-white/40"
                      />
                      <label className="block text-xs text-[#fdf3d8]/70">
                        Tanggal kenangan (opsional)
                        <input
                          type="date"
                          value={video.memoryDate ?? ""}
                          onChange={(event) => setGallery(updateVideo(gallery, video.mediaId, { memoryDate: event.target.value || null }))}
                          className="mt-1 w-full rounded-md border border-white/15 bg-[#0b1226] px-3 py-2 text-sm text-[#f8fafc]"
                        />
                      </label>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setGallery(moveVideo(gallery, index, -1))} disabled={index === 0} aria-label="Naikkan urutan video" className="rounded-md border border-white/20 px-3 py-1 text-xs disabled:opacity-40">↑</button>
                          <button type="button" onClick={() => setGallery(moveVideo(gallery, index, 1))} disabled={index === gallery.videos.length - 1} aria-label="Turunkan urutan video" className="rounded-md border border-white/20 px-3 py-1 text-xs disabled:opacity-40">↓</button>
                        </div>
                        <button type="button" onClick={() => setPendingRemove(video.mediaId)} className="rounded-md border border-red-400/50 px-3 py-1 text-xs text-red-200 hover:bg-red-500/10">Hapus dari galeri</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {gallery.photos.length > 0 && (
          <section className="space-y-4">
          <h4 className="font-display text-lg text-[#fdf3d8]">Foto Kenangan ({gallery.photos.length})</h4>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.photos.map((photo, index) => {
              const media = mediaState.files.find((f) => f.id === photo.mediaId);
              return (
                <li
                  key={photo.mediaId}
                  className="rounded-[14px] bg-[#fdf6e3] p-3 pb-6 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.8)] ring-1 ring-black/5"
                >
                  <div className="aspect-square overflow-hidden rounded-[6px] bg-black/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/${photo.mediaId}`}
                      alt={media?.name ?? "Foto galeri"}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <p className="mt-3 text-center text-[11px] uppercase tracking-[0.25em] text-[#7a6a4a]">
                    #{index + 1}
                  </p>

                  <div className="mt-3 space-y-2">
                    <input
                      value={photo.title}
                      onChange={(e) => setGallery(updatePhoto(gallery, photo.mediaId, { title: e.target.value }))}
                      placeholder="Judul foto"
                      maxLength={255}
                      className="w-full rounded-md border border-[#d8c9a3] bg-white/70 px-3 py-2 text-sm text-[#3a2f1c] placeholder-[#9a8b6a] focus:outline-none focus:ring-1 focus:ring-[#b99a4e]"
                    />
                    <textarea
                      value={photo.description}
                      onChange={(e) =>
                        setGallery(updatePhoto(gallery, photo.mediaId, { description: e.target.value }))
                      }
                      placeholder="Cerita foto ini…"
                      rows={3}
                      className="w-full rounded-md border border-[#d8c9a3] bg-white/70 px-3 py-2 text-sm leading-relaxed text-[#3d3020]"
                    />
                    <label className="block text-[11px] text-[#7a6a4a]">
                      Tanggal kenangan (opsional)
                      <input
                        type="date"
                        value={photo.memoryDate ?? ""}
                        onChange={(e) =>
                          setGallery(
                            updatePhoto(gallery, photo.mediaId, { memoryDate: e.target.value || null }),
                          )
                        }
                        className="mt-1 w-full rounded-md border border-[#d8c9a3] bg-white/70 px-3 py-1.5 text-sm text-[#3a3427]"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setGallery(movePhoto(gallery, index, -1))}
                        disabled={index === 0}
                        aria-label="Naikkan urutan foto"
                        className="rounded-md border border-[#d8c9a3] px-2.5 py-1 text-xs text-[#5a4c30] hover:bg-[#efe4c9] disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => setGallery(movePhoto(gallery, index, 1))}
                        disabled={index === gallery.photos.length - 1}
                        aria-label="Turunkan urutan foto"
                        className="rounded-md border border-[#d8c9a3] px-2.5 py-1 text-xs text-[#5a4c30] hover:bg-[#efe4c9] disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingRemove(photo.mediaId)}
                      className="rounded-md border border-red-400/50 px-3 py-1 text-xs text-red-700 hover:bg-red-500/10"
                    >
                      Hapus dari galeri
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          </section>
          )}
          </>
        )}
      </section>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Hapus media dari galeri?"
        description="Media ini dihapus dari susunan galeri saja. Berkas sumber tetap tersimpan di server dan Pustaka Media."
        confirmLabel="Hapus dari galeri"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={confirmReload}
        title="Muat ulang dari server?"
        description="Ada perubahan yang belum disimpan. Memuat ulang akan menimpa perubahan di layar ini dengan versi server."
        confirmLabel="Ya, muat ulang"
        onConfirm={() => void reloadFromServer()}
        onCancel={() => setConfirmReload(false)}
      />
    </div>
  );
}
