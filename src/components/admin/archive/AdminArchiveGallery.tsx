"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";
import { useToast } from "@/components/admin/ui/ToastProvider";
import {
  EMPTY_GALLERY_STATE,
  addPhoto,
  fromServerGallery,
  galleryLoadNote,
  gallerySaveMessage,
  galleryStatesEqual,
  isMediaUsed,
  loadGallery,
  loadMediaFiles,
  movePhoto,
  removePhoto,
  setIntro,
  splitMedia,
  updatePhoto,
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
 * - Removing a photo removes it from the GALLERY only; the source media file is
 *   never deleted here.
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

export default function AdminArchiveGallery() {
  const { showToast } = useToast();

  const [mediaState, setMediaState] = useState<MediaState>({ status: "loading", files: [] });
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [gallery, setGallery] = useState<GalleryState>(EMPTY_GALLERY_STATE);
  const [baseline, setBaseline] = useState<GalleryState>(EMPTY_GALLERY_STATE);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);

  const dirty = !galleryStatesEqual(gallery, baseline);

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

  function handleSetIntro(mediaId: string | null) {
    const result = setIntro(gallery, mediaId);
    if (!result.ok) {
      showToast({
        title: "Tidak bisa",
        message: "Media ini sudah dipakai sebagai foto galeri.",
        type: "info",
      });
      return;
    }
    setGallery(result.state);
  }

  function confirmRemove() {
    if (pendingRemove) {
      setGallery(removePhoto(gallery, pendingRemove));
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
            Video pembuka + galeri foto Polaroid. Referensi media privat (bukan URL). Perubahan
            hanya tersimpan setelah menekan “Simpan ke Server”.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
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
            Belum ada video tersimpan. Unggah video MP4 lewat halaman{" "}
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

      {/* ---------------------------------------------------- photo picker */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <h3 className="font-display text-lg text-[#fdf3d8]">Tambah Foto ke Galeri</h3>
        {images.length === 0 ? (
          <p className="text-xs text-[#fdf3d8]/60">
            Belum ada foto tersimpan. Unggah foto lewat halaman{" "}
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
            Galeri Polaroid ({gallery.photos.length})
          </h3>
          {gallery.photos.length > 0 && (
            <p className="text-xs text-[#fdf3d8]/60">
              Urutan tersimpan: {gallery.photos.map((p, i) => `${i + 1}`).join(" · ")}
            </p>
          )}
        </div>

        {gallery.photos.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#fdf3d8]/70">
            Belum ada foto di galeri.
          </p>
        ) : (
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
        )}
      </section>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Hapus foto dari galeri?"
        description="Foto ini dihapus dari galeri arsip. Berkas media sumbernya TIDAK dihapus dan tetap ada di Pustaka Media."
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
