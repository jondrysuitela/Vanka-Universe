"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/admin/ui/ToastProvider";
import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";

/**
 * Editor Konten — edit/hapus media yang sudah diunggah.
 *
 * Reads the REAL media store via `/api/media` (private, session-gated). No mock
 * data and no "add content" form (upload stays in Pustaka Media). Edit sends
 * PATCH and delete sends DELETE with the CSRF headers the API requires.
 *
 * Media can only be deleted when nothing references it; the API returns 409
 * otherwise and that is surfaced honestly.
 */

interface SavedMedia {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "video";
  size: number;
  ownerId: string;
  ownerLabel: string;
  createdAt: string;
  title: string | null;
  description: string | null;
  takenAt: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("id-ID");
}

const JSON_MUTATION_HEADERS = {
  "content-type": "application/json",
  "x-vanka-request": "1",
} as const;

export default function AdminContentPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<SavedMedia[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<SavedMedia | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTakenAt, setEditTakenAt] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<SavedMedia | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/media")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: SavedMedia[] }) => {
        if (active && Array.isArray(body.data)) setItems(body.data);
      })
      .catch(() => {
        if (active) setListError("Masuk sebagai admin untuk melihat media tersimpan.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function openEdit(item: SavedMedia) {
    setEditing(item);
    setEditTitle(item.title ?? "");
    setEditDescription(item.description ?? "");
    setEditTakenAt(item.takenAt ?? "");
    setEditError(null);
  }

  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/media/${editing.id}`, {
        method: "PATCH",
        headers: JSON_MUTATION_HEADERS,
        body: JSON.stringify({
          title: editTitle.trim() === "" ? null : editTitle.trim(),
          description: editDescription.trim() === "" ? null : editDescription,
          takenAt: editTakenAt.trim() === "" ? null : editTakenAt,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: SavedMedia; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.data) {
        setEditError(body?.error?.message ?? "Gagal menyimpan metadata.");
        return;
      }
      const updated = body.data;
      setItems((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
      showToast({ title: "Metadata disimpan", message: "Perubahan tersimpan di penyimpanan lokal server.", type: "success" });
    } catch {
      setEditError("Tidak dapat menghubungi server.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || removing) return;
    setRemoving(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/media/${deleting.id}`, {
        method: "DELETE",
        headers: JSON_MUTATION_HEADERS,
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { id: string }; error?: { code?: string; message?: string } }
        | null;
      if (res.status === 409) {
        setDeleteError(body?.error?.message ?? "Media masih direferensikan.");
        return;
      }
      if (!res.ok) {
        setDeleteError(body?.error?.message ?? "Gagal menghapus media.");
        return;
      }
      setItems((prev) => prev.filter((m) => m.id !== deleting.id));
      showToast({ title: "Media dihapus", message: "File dan metadatanya dihapus dari penyimpanan lokal server.", type: "info" });
      setDeleting(null);
    } catch {
      setDeleteError("Tidak dapat menghubungi server.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Editor Konten</h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-2">
          Media terunggah dari Pustaka Media. Halaman ini tidak menambah konten baru — hanya mengubah metadata dan menghapus.
        </p>
      </div>

      {loading ? (
        <p className="rounded-2xl border border-white/10 bg-[#0b1226]/70 px-6 py-4 text-sm text-[#fdf3d8]/70 backdrop-blur-xl">
          Memuat media…
        </p>
      ) : listError ? (
        <p className="rounded-2xl border border-white/10 bg-[#0b1226]/70 px-6 py-4 text-sm text-[#fdf3d8]/70 backdrop-blur-xl">
          {listError}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-8 text-center space-y-2">
          <p className="font-medium text-[#fdf3d8]">Belum ada media tersimpan.</p>
          <p className="text-sm text-[#fdf3d8]/70">Unggah foto atau video melalui menu Pustaka Media agar muncul di sini.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl overflow-hidden">
              <div className="aspect-video bg-black/40 flex items-center justify-center">
                {item.kind === "image" ? (
                  // Private endpoint; next/image cannot attach the session cookie
                  // through the optimizer, so <img> is used.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${item.id}`} alt={item.title ?? item.name} className="h-full w-full object-cover" />
                ) : (
                  <video
                    src={`/api/media/${item.id}`}
                    controls
                    preload="metadata"
                    aria-label={item.title ?? item.name}
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
              <div className="p-4 space-y-2">
                <h2 className="text-sm font-medium text-[#fdf3d8] break-all">
                  {item.title?.trim() ? item.title : item.name}
                </h2>
                {item.title?.trim() && <p className="text-xs text-[#fdf3d8]/50 break-all">{item.name}</p>}
                <p className="text-xs text-[#fdf3d8]/60">
                  {item.kind === "image" ? "Gambar" : "Video"} · {formatBytes(item.size)}
                </p>
                <p className="text-xs text-[#fdf3d8]/60">
                  Tanggal pengambilan: {item.takenAt ?? "belum diisi"}
                </p>
                <p className="text-xs text-[#fdf3d8]/50">Diunggah: {formatDateTime(item.createdAt)}</p>
                {item.description && (
                  <p className="text-xs text-[#fdf3d8]/70 whitespace-pre-wrap">{item.description}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-xs text-[#fdf3d8]/90 hover:bg-white/5 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleting(item);
                      setDeleteError(null);
                    }}
                    className="rounded-lg border border-red-400/40 px-4 py-2 text-xs text-red-200 hover:bg-red-500/10 transition-colors"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit metadata media">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1226] p-6 space-y-4">
            <h2 className="text-lg font-display text-[#fdf3d8]">Edit Metadata Media</h2>

            <div>
              <label htmlFor="edit-title" className="text-sm text-[#fdf3d8]/80">
                Judul
              </label>
              <input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                placeholder="Judul media (opsional)"
              />
            </div>

            <div>
              <label htmlFor="edit-description" className="text-sm text-[#fdf3d8]/80">
                Deskripsi
              </label>
              <textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                placeholder="Deskripsi (opsional)"
              />
            </div>

            <div>
              <label htmlFor="edit-taken" className="text-sm text-[#fdf3d8]/80">
                Tanggal Pengambilan
              </label>
              <input
                id="edit-taken"
                type="date"
                value={editTakenAt}
                onChange={(e) => setEditTakenAt(e.target.value)}
                className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
              />
              <p className="text-xs text-[#fdf3d8]/55 mt-1">Berbeda dari tanggal upload ({formatDateTime(editing.createdAt)}).</p>
            </div>

            {editError && (
              <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {editError}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-6 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity disabled:opacity-50"
              >
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5 transition-colors"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Hapus Media"
        description={
          deleting
            ? `Hapus "${deleting.title?.trim() ? deleting.title : deleting.name}"? File dan metadatanya dihapus dari penyimpanan lokal server. Tindakan ini tidak dapat dibatalkan.`
            : ""
        }
        confirmLabel={removing ? "Menghapus…" : "Hapus"}
        cancelLabel="Batal"
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!removing) setDeleting(null);
        }}
      />

      {deleteError && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {deleteError}
        </p>
      )}
    </div>
  );
}
