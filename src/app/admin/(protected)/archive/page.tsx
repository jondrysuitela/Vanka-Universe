"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/ui/ToastProvider";
import {
  EMPTY_ARCHIVE_DRAFT,
  loadArchiveDraft,
  saveArchiveDraft,
  type PrivateArchiveDraft,
} from "@/lib/archive/draft";
import {
  archiveStatusNote,
  loadArchive,
  reconcileArchive,
  saveArchive,
  saveArchiveMessage,
  toDraftFromServer,
  type ArchiveServerStatus,
  type ServerArchive,
} from "@/lib/archive/archive-sync";
import AdminArchiveGallery from "@/components/admin/archive/AdminArchiveGallery";

/**
 * Arsip Privat — "Tentang Ibumu".
 *
 * Edits the private archive narrative and syncs it only after explicit server
 * save. Media files upload separately; gallery membership and ordering are
 * saved by the gallery editor below.
 */

export default function AdminArchivePage() {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<PrivateArchiveDraft>(EMPTY_ARCHIVE_DRAFT);

  // Server view (read-only) + explicit-save state. Local draft is untouched.
  const [serverStatus, setServerStatus] = useState<ArchiveServerStatus>("checking");
  const [serverArchive, setServerArchive] = useState<ServerArchive | null>(null);
  const [savingToServer, setSavingToServer] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDraft(loadArchiveDraft()));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Read the server archive ONCE (GET only). No write, no auto-overwrite.
  // A failed load is reported honestly and never treated as "no archive".
  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await loadArchive(fetch);
      if (!active) return;
      if (result.status === "ok") {
        setServerStatus("ok");
        setServerArchive(result.archive);
      } else {
        setServerStatus(result.status);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function update(patch: Partial<PrivateArchiveDraft>) {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      saveArchiveDraft(next);
      return next;
    });
  }

  function saveLocal() {
    saveArchiveDraft(draft);
    showToast({
      title: "Draf lokal disimpan",
      message: "Tersimpan di browser ini (localStorage). Belum tersimpan di server; tidak berlaku di perangkat lain.",
      type: "success",
    });
  }

  /**
   * Explicit server save. Never writes/deletes the local draft and never claims
   * success unless the server confirmed it.
   */
  async function saveToServer() {
    if (savingToServer) return;
    setSavingToServer(true);
    try {
      const result = await saveArchive(fetch, draft);
      showToast(saveArchiveMessage(result));
      if (result.status === "saved") {
        setServerStatus("ok");
        setServerArchive(result.archive);
      } else if (result.status === "unauthorized") {
        setServerStatus("unauthorized");
      } else if (result.status === "unavailable") {
        setServerStatus("unavailable");
      }
    } finally {
      setSavingToServer(false);
    }
  }

  /** Explicitly load the server version into the editor — never automatic. */
  function loadServerIntoTeditor() {
    if (!serverArchive) return;
    setDraft(toDraftFromServer(serverArchive));
    showToast({
      title: "Versi server dimuat ke editor",
      message:
        "Isi editor kini menampilkan versi server. Belum disimpan ke draf lokal; tekan “Simpan Draf Lokal” bila ingin menyimpannya di browser ini.",
      type: "info",
    });
  }

  const recon = reconcileArchive(draft, serverArchive);
  const statusNote = archiveStatusNote(serverStatus, recon.hasServer);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Arsip Privat</h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-2">
          Arsip privat “Tentang Ibumu” — terpisah dari arsip ulang tahun publik, tidak dipublikasikan otomatis.
        </p>
        <p
          role="status"
          className={`mt-3 rounded-lg border px-4 py-3 text-xs ${
            statusNote.tone === "error"
              ? "border-red-400/40 bg-red-500/10 text-red-100"
              : statusNote.tone === "warn"
                ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                : "border-[#f6d77a]/30 bg-[#f6d77a]/10 text-[#fdf3d8]/80"
          }`}
        >
          {statusNote.text}
        </p>
      </div>

      <div>
        <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
          <h2 className="text-lg font-display text-[#fdf3d8]">Draf Lokal Arsip</h2>

          <div>
            <label htmlFor="archive-title" className="text-sm text-[#fdf3d8]/80">
              Judul Arsip
            </label>
            <input
              id="archive-title"
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
              placeholder="Tentang Ibumu"
            />
          </div>

          <div>
            <label htmlFor="archive-narrative" className="text-sm text-[#fdf3d8]/80">
              Narasi / Biografi
            </label>
            <textarea
              id="archive-narrative"
              value={draft.narrative}
              onChange={(e) => update({ narrative: e.target.value })}
              rows={7}
              className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm leading-relaxed text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
              placeholder="Tulis narasi pada draf lokal ini…"
            />
            <p className="text-xs text-[#fdf3d8]/55 mt-1">Pisahkan paragraf dengan baris kosong.</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={saveLocal}
              className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-6 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
            >
              Simpan Draf Lokal
            </button>
            <button
              type="button"
              onClick={saveToServer}
              disabled={savingToServer}
              className="rounded-lg bg-emerald-400/20 border border-emerald-300/40 px-6 py-2.5 text-sm text-emerald-100 hover:bg-emerald-400/30 transition-colors disabled:opacity-45"
            >
              {savingToServer ? "Menyimpan ke server…" : "Simpan ke Server"}
            </button>
            <Link
              href="/admin/archive/preview"
              className="rounded-lg border border-[#f6d77a]/40 px-6 py-2.5 text-sm text-center text-[#f6d77a] hover:bg-[#f6d77a]/10 transition-colors"
            >
              Preview Arsip
            </Link>
          </div>

          {(recon.diverged || recon.serverOnly) && serverArchive && (
            <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 space-y-3">
              <p className="text-xs text-red-100">
                {recon.diverged
                  ? "Draf lokal dan versi server untuk arsip ini BERBEDA. Tidak ada yang dipilih otomatis — pilih salah satu secara sadar."
                  : "Tidak ada draf lokal untuk arsip ini, tetapi ada versi tersimpan di server."}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={loadServerIntoTeditor}
                  className="rounded-lg border border-white/20 px-4 py-2 text-xs text-[#fdf3d8]/90 hover:bg-white/5 transition-colors"
                >
                  Muat Versi Server ke Editor
                </button>
                <button
                  type="button"
                  onClick={saveToServer}
                  disabled={savingToServer}
                  className="rounded-lg border border-emerald-300/40 px-4 py-2 text-xs text-emerald-100 hover:bg-emerald-400/10 transition-colors disabled:opacity-45"
                >
                  Kirim Draf Lokal ke Server
                </button>
              </div>
            </div>
          )}

          <p className="rounded-lg border border-[#f6d77a]/30 bg-[#f6d77a]/10 px-4 py-3 text-xs text-[#fdf3d8]/80">
            Draf selalu tersimpan di browser ini (localStorage). Menekan “Simpan ke Server” juga mengirim
            arsip ke server bila database tersedia; draf lokal di browser TIDAK dihapus atau ditimpa. Bila
            server/database belum tersedia, arsip tetap draf lokal dan belum tersimpan di server.
          </p>

        </section>
      </div>

      <AdminArchiveGallery />
    </div>
  );
}
