"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/admin/ui/ToastProvider";
import {
  EMPTY_ARCHIVE_DRAFT,
  hasArchiveContent,
  loadArchiveDraft,
  saveArchiveDraft,
  type PrivateArchiveDraft,
} from "@/lib/archive/draft";
import {
  AUDIO_LIMITATION_TEXT,
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
 * HONEST STATE: there is no private-archive experience, no PIN system, and no
 * audio asset. Local drafts stay BROWSER-ONLY (localStorage) and are ALWAYS
 * preserved. When a database is configured and the session is authorized, the
 * page can ALSO save the archive to the server via `PUT /api/archive`. Server
 * saving never deletes or overwrites the local draft, never silently falls back
 * to localStorage after a failed write, and never claims a success it did not
 * get. The archive stays private: no public route, no client-supplied privacy.
 */

interface SavedMedia {
  id: string;
  name: string;
  kind: "image" | "video";
  size: number;
  createdAt: string;
}

type Probe =
  | { state: "loading" }
  | { state: "ok"; count: number }
  | { state: "unavailable" };

export default function AdminArchivePage() {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<PrivateArchiveDraft>(EMPTY_ARCHIVE_DRAFT);
  const [media, setMedia] = useState<Probe>({ state: "loading" });
  const [memories, setMemories] = useState<Probe>({ state: "loading" });

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

  useEffect(() => {
    let active = true;
    fetch("/api/media")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { data?: SavedMedia[] }) => {
        if (active) setMedia({ state: "ok", count: Array.isArray(body.data) ? body.data.length : 0 });
      })
      .catch(() => {
        if (active) setMedia({ state: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/memories?limit=1")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { meta?: { total?: number } }) => {
        if (active) {
          setMemories({ state: "ok", count: typeof body.meta?.total === "number" ? body.meta.total : 0 });
        }
      })
      .catch(() => {
        if (active) setMemories({ state: "unavailable" });
      });
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

  const contentReady = hasArchiveContent(draft);
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

      <div className="rounded-2xl border border-[#f6d77a]/30 bg-[#f6d77a]/10 px-5 py-4 text-sm text-[#fdf3d8]/85 space-y-1">
        <p className="font-medium text-[#fdf3d8]">Status implementasi (fakta)</p>
        <p>
          Belum ada pengalaman arsip privat, sistem PIN, maupun aset audio di kode. API arsip privat
          (GET/PUT) sudah ada, tetapi database belum dikonfigurasi pada environment ini. Karena itu tidak
          ada CRUD koleksi palsu. Yang tersedia di halaman ini: draf lokal di browser (selalu dipertahankan)
          dan—bila server tersedia—penyimpanan arsip ke server secara eksplisit.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
          <h2 className="text-lg font-display text-[#fdf3d8]">Status Konfigurasi</h2>
          <ul className="space-y-3 text-sm">
            <StatusRow label="PIN" value="Belum tersedia — tidak ada sistem PIN di kode." tone="blocked" />
            <StatusRow
              label="Konten (kenangan)"
              value={probeText(memories, (n) => `${n} kenangan tersimpan`)}
              tone={probeTone(memories)}
            />
            <StatusRow
              label="Media"
              value={probeText(media, (n) => `${n} media tersimpan`)}
              tone={probeTone(media)}
            />
            <StatusRow label="Musik" value={AUDIO_LIMITATION_TEXT} tone="blocked" />
            <StatusRow
              label="Persistensi konfigurasi"
              value={
                serverStatus === "ok"
                  ? recon.hasServer
                    ? "Tersimpan di server + draf lokal browser."
                    : "Belum ada arsip di server; draf lokal browser (belum diunggah ke server)."
                  : serverStatus === "unauthorized"
                    ? "Draf lokal browser. Server menolak sesi/peran."
                    : serverStatus === "checking"
                      ? "Memeriksa… draf lokal browser tetap aman."
                      : "Draf lokal browser — server/database belum tersedia (belum tersimpan di server)."
              }
              tone={serverStatus === "ok" && recon.hasServer ? "ok" : "unknown"}
            />
          </ul>
        </section>

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

          <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#fdf3d8]">Musik Arsip Privat</p>
              <p className="text-xs text-[#fdf3d8]/55">
                Hanya draf lokal. Pemilihan aset audio belum tersedia di kode ini.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.musicEnabled}
              aria-label="Aktifkan musik arsip privat"
              onClick={() => update({ musicEnabled: !draft.musicEnabled })}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                draft.musicEnabled ? "bg-[#f6d77a]" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-[#050814] transition-transform ${
                  draft.musicEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-[#fdf3d8]/70 space-y-1">
            <p className="text-sm font-medium text-[#fdf3d8]">Urutan storytelling</p>
            <p>
              Belum dapat diatur: tidak ada item media arsip yang tersimpan. Urutan tidak dibuat-buat.
            </p>
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

          {!contentReady && (
            <p className="text-xs text-[#fdf3d8]/55">
              Isi judul atau narasi dulu untuk melihat konten nyata di pratinjau.
            </p>
          )}
        </section>
      </div>

      <AdminArchiveGallery />
    </div>
  );
}

function probeText(probe: Probe, okLabel: (count: number) => string): string {
  if (probe.state === "loading") return "Memeriksa…";
  if (probe.state === "ok") return okLabel(probe.count);
  return "Tidak dapat diverifikasi (sesi/DB belum tersedia).";
}

function probeTone(probe: Probe): StatusTone {
  if (probe.state === "ok") return "ok";
  if (probe.state === "unavailable") return "unknown";
  return "unknown";
}

type StatusTone = "ok" | "blocked" | "unknown";

function StatusRow({ label, value, tone }: { label: string; value: string; tone: StatusTone }) {
  const dot = tone === "ok" ? "bg-[#7ee0a3]" : tone === "blocked" ? "bg-[#f08a8a]" : "bg-[#f6d77a]";
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-[#fdf3d8]/85">
        <span className="font-medium text-[#fdf3d8]">{label}:</span> {value}
      </span>
    </li>
  );
}
