"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/ui/ToastProvider";
import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";
import {
  DEFAULT_LETTER_DRAFT,
  DEFAULT_LETTER_THUMBNAIL,
  splitIntoScenes,
  loadLetterForAge,
  saveLetterForAge,
  deleteLetterForAge,
  listSavedLetterAges,
  type LetterDraft,
  type LetterSection,
  type LetterThumbnail,
} from "@/components/birthday/LetterScene";
import { BIRTHDAY_THEMES, getThemeByAge } from "@/lib/birthday/theme-registry";
import { isCycleRevealed } from "@/lib/birthday/cycle";
import {
  loadLetters,
  reconcileLetter,
  saveLetterEnsuringEdition,
  saveOutcomeMessage,
  serverLetterAge,
  serverStatusNote,
  toDraftFromServer,
  type ServerLetter,
  type ServerStatus,
} from "@/lib/birthday/letter-sync";

/**
 * Tulis Surat — manage one letter per birthday edition (age 1–17).
 *
 * Local drafts stay BROWSER-ONLY (localStorage), isolated per edition age, and
 * are ALWAYS preserved. When a database is configured and the session is
 * authorized, the page can ALSO save a draft to the server via
 * `POST /api/birthday/letters` (creating the edition first when needed). Server
 * saving never deletes or overwrites the local draft, never silently falls back
 * to localStorage after a failed write, and never claims a success it did not
 * get. Editing a letter for one age never touches another. Ayah's text
 * (`DEFAULT_LETTER_TEXT`) is unchanged and remains the starting point for age 1.
 */

/** A brand-new letter: age 1 starts from Ayah's existing letter, others blank. */
function blankDraftForAge(age: number): LetterDraft {
  if (age === 1) return DEFAULT_LETTER_DRAFT;
  return {
    title: "",
    date: "",
    fullText: "",
    sections: [],
    thumbnail: DEFAULT_LETTER_THUMBNAIL,
  };
}

function editionIdentity(age: number): { title: string; subtitle: string; year: number } {
  const theme = getThemeByAge(age);
  return {
    title: theme?.title ?? `Usia ${age}`,
    subtitle: theme?.subtitle ?? "",
    year: theme?.year ?? 0,
  };
}

export default function AdminBirthdayPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [savedAges, setSavedAges] = useState<number[]>([]);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);

  const [letterTitle, setLetterTitle] = useState("");
  const [letterDate, setLetterDate] = useState("");
  const [letterText, setLetterText] = useState("");
  const [letterSections, setLetterSections] = useState<LetterSection[]>([]);
  const [thumbnail, setThumbnail] = useState<LetterThumbnail>(DEFAULT_LETTER_THUMBNAIL);

  const [addOpen, setAddOpen] = useState(false);
  const [addAge, setAddAge] = useState(1);
  const [openDelete, setOpenDelete] = useState(false);

  // Server view (read-only) + explicit-save state. Local drafts are untouched.
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [serverLetters, setServerLetters] = useState<Map<number, ServerLetter>>(new Map());
  const [savingToServer, setSavingToServer] = useState(false);

  // Published-by-date: an edition whose birthday has passed is FROZEN — the
  // server refuses further writes — so the editor must not offer a save that can
  // only fail. The public version is the letter as it stood at the reveal.
  const frozenYear = selectedAge == null ? null : (getThemeByAge(selectedAge)?.year ?? null);
  const frozen = frozenYear !== null && isCycleRevealed(frozenYear, new Date());

  function applyDraft(draft: LetterDraft) {
    setLetterTitle(draft.title);
    setLetterDate(draft.date);
    setLetterText(draft.fullText);
    setLetterSections(draft.sections);
    setThumbnail(draft.thumbnail ?? DEFAULT_LETTER_THUMBNAIL);
  }

  function selectAge(age: number) {
    applyDraft(loadLetterForAge(age) ?? blankDraftForAge(age));
    setSelectedAge(age);
    setAddOpen(false);
  }

  // Restore saved letters (browser-only draft) on mount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const ages = listSavedLetterAges();
      setSavedAges(ages);
      if (ages.length > 0) {
        const age = ages.includes(1) ? 1 : ages[0];
        const draft = loadLetterForAge(age) ?? blankDraftForAge(age);
        setLetterTitle(draft.title);
        setLetterDate(draft.date);
        setLetterText(draft.fullText);
        setLetterSections(draft.sections);
        setThumbnail(draft.thumbnail ?? DEFAULT_LETTER_THUMBNAIL);
        setSelectedAge(age);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Read persisted letters ONCE (GET only). No write, no edition auto-create.
  // A failed load is reported honestly and never treated as "no letters".
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadLetters(fetch);
      if (cancelled) return;
      if (result.status === "ok") {
        const map = new Map<number, ServerLetter>();
        for (const letter of result.letters) {
          const age = serverLetterAge(letter);
          if (age != null) map.set(age, letter);
        }
        setServerStatus("ok");
        setServerLetters(map);
      } else {
        setServerStatus(result.status);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function currentDraft(): LetterDraft {
    return {
      title: letterTitle,
      date: letterDate,
      fullText: letterText,
      sections: letterSections,
      thumbnail: {
        src: thumbnail.src?.trim() || undefined,
        alt: thumbnail.alt.trim() || DEFAULT_LETTER_THUMBNAIL.alt,
        caption: thumbnail.caption?.trim() || undefined,
      },
    };
  }

  function openAdd() {
    const nextAge = BIRTHDAY_THEMES.map((t) => t.age).find((age) => !savedAges.includes(age)) ?? 1;
    setAddAge(nextAge);
    setAddOpen(true);
  }

  function createLetter() {
    if (!savedAges.includes(addAge)) {
      saveLetterForAge(addAge, blankDraftForAge(addAge));
      setSavedAges(listSavedLetterAges());
    }
    selectAge(addAge);
    showToast({
      title: "Surat dibuat",
      message: `Surat untuk usia ${addAge} siap diedit (draf lokal di browser ini).`,
      type: "info",
    });
  }

  function saveLetter() {
    if (selectedAge == null) return;
    saveLetterForAge(selectedAge, currentDraft());
    setSavedAges(listSavedLetterAges());
    showToast({
      title: "Draf lokal disimpan",
      message: `Surat usia ${selectedAge} tersimpan di browser ini (localStorage). Belum tersimpan di server.`,
      type: "success",
    });
  }

  /**
   * Explicit server save. Never writes/deletes the local draft and never claims
   * success unless the server confirmed it. Creates the edition first (on the
   * `EDITION_NOT_FOUND` signal) — an intentional action, not a page-load burst.
   */
  async function saveToServer() {
    if (selectedAge == null || savingToServer) return;
    if (frozen) {
      showToast({
        title: "Sudah tayang — dibekukan",
        message:
          "Edisi ini sudah lewat tanggal ulang tahunnya; suratnya dibekukan dan tidak dikirim ulang ke server.",
        type: "error",
      });
      return;
    }
    const age = selectedAge;
    setSavingToServer(true);
    try {
      const outcome = await saveLetterEnsuringEdition(fetch, age, currentDraft());
      showToast(saveOutcomeMessage(outcome, age));
      if (outcome.status === "saved") {
        setServerStatus("ok");
        setServerLetters((prev) => {
          const next = new Map(prev);
          next.set(age, outcome.letter);
          return next;
        });
      } else if (outcome.status === "unauthorized") {
        setServerStatus("unauthorized");
      } else if (outcome.status === "unavailable") {
        setServerStatus("unavailable");
      }
    } finally {
      setSavingToServer(false);
    }
  }

  /** Explicitly load the server version into the editor — never automatic. */
  function loadServerIntoTeditor() {
    if (selectedAge == null) return;
    const server = serverLetters.get(selectedAge);
    if (!server) return;
    applyDraft(toDraftFromServer(server));
    showToast({
      title: "Versi server dimuat ke editor",
      message:
        "Isi editor kini menampilkan versi server. Belum disimpan ke draf lokal; tekan “Simpan Draf Lokal” bila ingin menyimpannya di browser ini.",
      type: "info",
    });
  }

  function confirmDelete() {
    if (selectedAge == null) return;
    const age = selectedAge;
    deleteLetterForAge(age);
    const ages = listSavedLetterAges();
    setSavedAges(ages);
    setOpenDelete(false);
    if (ages.length > 0) {
      selectAge(ages.includes(1) ? 1 : ages[0]);
    } else {
      setSelectedAge(null);
    }
    showToast({
      title: "Surat dihapus",
      message: `Draf surat usia ${age} dihapus dari browser ini. Tidak ada surat lain yang terpengaruh.`,
      type: "info",
    });
  }

  function splitLetter() {
    setLetterSections(splitIntoScenes(letterText));
    showToast({
      title: "Surat dibagi",
      message: "Surat dibagi menjadi scene berdasarkan paragraf. Tinjau dan ubah bila perlu.",
      type: "info",
    });
  }

  function previewLetter() {
    if (selectedAge == null) return;
    saveLetterForAge(selectedAge, currentDraft());
    setSavedAges(listSavedLetterAges());
    router.push(`/birthday-experience?preview=1&letter=1&age=${selectedAge}`);
  }

  /**
   * Preview the WHOLE experience for this edition from its very beginning: the
   * gift box → the opening frame (this edition's chosen thumbnail) → the letter
   * → the memory box. The local draft is saved first so the preview shows exactly
   * what is in the editor (same rule as "Preview Surat"). `full=1` is what makes
   * the page load the edited draft instead of the bundled default — without it
   * the opening frame falls back to the honest placeholder.
   */
  function previewExperience() {
    if (selectedAge == null) return;
    saveLetterForAge(selectedAge, currentDraft());
    setSavedAges(listSavedLetterAges());
    router.push(`/birthday-experience?preview=1&full=1&age=${selectedAge}`);
  }

  function updateSection(id: string, patch: Partial<LetterSection>) {
    setLetterSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function moveSection(id: string, dir: -1 | 1) {
    setLetterSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  const selectedTheme = selectedAge != null ? editionIdentity(selectedAge) : null;
  const statusNote = serverStatusNote(serverStatus, serverLetters.size);
  // Union of local draft ages and server letter ages (ascending) — shown side by side.
  const allAges = Array.from(new Set<number>([...savedAges, ...serverLetters.keys()])).sort(
    (a, b) => a - b,
  );
  const selectedServer = selectedAge != null ? serverLetters.get(selectedAge) ?? null : null;
  const selectedRecon =
    selectedAge == null ? null : reconcileLetter(selectedAge, loadLetterForAge(selectedAge), selectedServer);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Tulis Surat</h1>
            <p className="text-sm text-[#fdf3d8]/70 mt-2">
              Kelola satu surat untuk setiap edisi ulang tahun (usia 1–17). Draf selalu tersimpan lokal di
              browser ini (localStorage); saat server tersedia, draf juga dapat dikirim ke server. Identitas
              tema dibaca dari Katalog Tema Tahunan.
            </p>
          </div>
        </div>
        <p
          className={`mt-3 rounded-lg border px-4 py-3 text-xs ${
            statusNote.tone === "error"
              ? "border-red-400/40 bg-red-500/10 text-red-100"
              : statusNote.tone === "warn"
                ? "border-amber-300/40 bg-amber-400/10 text-amber-100"
                : "border-[#f6d77a]/30 bg-[#f6d77a]/10 text-[#fdf3d8]/80"
          }`}
          role="status"
        >
          {statusNote.text}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-display text-[#fdf3d8]">Surat per Edisi</h2>
            <button
              type="button"
              onClick={openAdd}
              className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-4 py-2 text-xs font-medium hover:opacity-95 transition-opacity"
            >
              Tambah Surat
            </button>
          </div>

          {allAges.length === 0 ? (
            <p className="text-xs text-[#fdf3d8]/60">
              Belum ada surat. Tekan “Tambah Surat” untuk memulai surat untuk salah satu edisi.
            </p>
          ) : (
            <div className="space-y-2">
              {allAges.map((age) => {
                const identity = editionIdentity(age);
                const draft = loadLetterForAge(age);
                const server = serverLetters.get(age) ?? null;
                const recon = reconcileLetter(age, draft, server);
                const active = selectedAge === age;
                return (
                  <button
                    key={age}
                    type="button"
                    onClick={() => selectAge(age)}
                    className={`w-full text-left rounded-xl px-4 py-3 transition-colors ${
                      active
                        ? "bg-white/10 text-[#fdf3d8]"
                        : "text-[#fdf3d8]/80 hover:bg-white/5 hover:text-[#fdf3d8]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Usia {age}</span>
                      <span className="text-xs text-[#fdf3d8]/60">{identity.year}</span>
                    </div>
                    <p className="text-xs text-[#fdf3d8]/60 mt-1">{identity.title}</p>
                    <p className="text-xs text-[#fdf3d8]/50 mt-0.5 truncate">
                      {draft?.title?.trim() ? draft.title : "Tanpa judul"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {recon.hasLocal && (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#fdf3d8]/80">
                          lokal
                        </span>
                      )}
                      {recon.hasServer && (
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-100">
                          server
                        </span>
                      )}
                      {recon.localPending && (
                        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-100">
                          perlu kirim
                        </span>
                      )}
                      {recon.diverged && (
                        <span className="rounded-full bg-red-400/15 px-2 py-0.5 text-[10px] text-red-100">
                          beda
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-6">
          {selectedAge == null ? (
            <div className="space-y-2 text-sm text-[#fdf3d8]/70">
              <p className="font-medium text-[#fdf3d8]">Belum ada surat yang dipilih.</p>
              <p>
                Pilih salah satu surat di daftar, atau tekan “Tambah Surat” untuk membuat surat baru
                bagi edisi usia 1–17.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-[#f6d77a]">
                    Edisi · Usia {selectedAge} · {selectedTheme?.year}
                  </p>
                  <h2 className="mt-1 font-display text-lg text-[#fdf3d8]">{selectedTheme?.title}</h2>
                  {selectedTheme?.subtitle && (
                    <p className="text-xs text-[#fdf3d8]/60">{selectedTheme.subtitle}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpenDelete(true)}
                  className="rounded-lg border border-red-400/40 px-4 py-2 text-xs text-red-200 hover:bg-red-500/10 transition-colors"
                >
                  Hapus Surat
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="letter-title" className="text-sm text-[#fdf3d8]/80">
                    Judul Surat
                  </label>
                  <input
                    id="letter-title"
                    value={letterTitle}
                    onChange={(e) => setLetterTitle(e.target.value)}
                    className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                    placeholder="Judul surat"
                  />
                </div>
                <div>
                  <label htmlFor="letter-date" className="text-sm text-[#fdf3d8]/80">
                    Tanggal Surat
                  </label>
                  <input
                    id="letter-date"
                    value={letterDate}
                    onChange={(e) => setLetterDate(e.target.value)}
                    className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                    placeholder="27 Oktober 2026"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="letter-full" className="text-sm text-[#fdf3d8]/80">
                  Isi Surat Lengkap
                </label>
                <textarea
                  id="letter-full"
                  value={letterText}
                  onChange={(e) => setLetterText(e.target.value)}
                  rows={14}
                  className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm leading-relaxed text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                  placeholder="Tulis seluruh isi surat untuk edisi ini..."
                />
                <p className="text-xs text-[#fdf3d8]/60 mt-2">
                  Pisahkan paragraf dengan baris kosong. Tandai judul scene dengan **dua bintang**.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-3">
                <button
                  type="button"
                  onClick={splitLetter}
                  className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-6 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
                >
                  Bagi Menjadi Scene
                </button>
                <button
                  type="button"
                  onClick={saveLetter}
                  disabled={frozen}
                  title={frozen ? "Edisi ini sudah tayang — surat dibekukan." : undefined}
                  className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  Simpan Draf Lokal
                </button>
                <button
                  type="button"
                  onClick={previewLetter}
                  className="rounded-lg border border-[#f6d77a]/40 px-6 py-2.5 text-sm text-[#f6d77a] hover:bg-[#f6d77a]/10 transition-colors"
                >
                  Preview Surat
                </button>
                <button
                  type="button"
                  onClick={previewExperience}
                  className="rounded-lg border border-[#f6d77a]/40 px-6 py-2.5 text-sm text-[#f6d77a] hover:bg-[#f6d77a]/10 transition-colors"
                >
                  Preview Pengalaman
                </button>
                <button
                  type="button"
                  onClick={saveToServer}
                  disabled={savingToServer || frozen}
                  title={frozen ? "Edisi ini sudah tayang — surat dibekukan." : undefined}
                  className="rounded-lg bg-emerald-400/20 border border-emerald-300/40 px-6 py-2.5 text-sm text-emerald-100 hover:bg-emerald-400/30 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {savingToServer ? "Menyimpan ke server…" : "Simpan ke Server"}
                </button>
              </div>

              {frozen && (
                <p className="rounded-lg border border-[#f6d77a]/40 bg-[#f6d77a]/10 px-4 py-3 text-xs text-[#fdf3d8]/85">
                  Edisi {frozenYear} sudah <strong>tayang</strong> — suratnya dibekukan otomatis
                  sejak tanggal ulang tahunnya, jadi versi publik tidak berubah lagi. Menyimpan ke
                  server tidak tersedia untuk edisi yang sudah tayang.
                </p>
              )}

              {(selectedRecon?.diverged || selectedRecon?.serverOnly) && selectedServer && (
                <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 space-y-3">
                  <p className="text-xs text-red-100">
                    {selectedRecon.diverged
                      ? "Draf lokal dan versi server untuk edisi ini BERBEDA. Tidak ada yang dipilih otomatis — pilih salah satu secara sadar."
                      : "Tidak ada draf lokal untuk edisi ini, tetapi ada versi tersimpan di server."}
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
                      disabled={savingToServer || frozen}
                      title={frozen ? "Edisi ini sudah tayang — surat dibekukan." : undefined}
                      className="rounded-lg border border-emerald-300/40 px-4 py-2 text-xs text-emerald-100 hover:bg-emerald-400/10 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      Kirim Draf Lokal ke Server
                    </button>
                  </div>
                </div>
              )}

              <p className="rounded-lg border border-[#f6d77a]/30 bg-[#f6d77a]/10 px-4 py-3 text-xs text-[#fdf3d8]/80">
                Draf per edisi selalu tersimpan di browser ini (localStorage) dan tidak saling menimpa.
                Menekan “Simpan ke Server” juga mengirim draf ke server bila database tersedia; draf
                lokal di browser TIDAK dihapus atau ditimpa. Bila server/database belum tersedia, surat
                tetap draf lokal dan belum tersimpan di server.
              </p>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-[#fdf3d8]">Scene Surat</h3>
                  <span className="text-xs text-[#fdf3d8]/60">{letterSections.length} scene</span>
                </div>

                {letterSections.length === 0 && (
                  <p className="text-xs text-[#fdf3d8]/60">
                    Belum ada scene. Tekan “Bagi Menjadi Scene”.
                  </p>
                )}

                {letterSections.map((section, i) => (
                  <div key={section.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-[0.25em] text-[#f6d77a]">
                        Scene {i + 1}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => moveSection(section.id, -1)}
                          disabled={i === 0}
                          aria-label={`Naikkan scene ${i + 1}`}
                          className="rounded-md border border-white/15 px-3 py-1 text-xs text-[#fdf3d8]/90 disabled:opacity-35"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSection(section.id, 1)}
                          disabled={i === letterSections.length - 1}
                          aria-label={`Turunkan scene ${i + 1}`}
                          className="rounded-md border border-white/15 px-3 py-1 text-xs text-[#fdf3d8]/90 disabled:opacity-35"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                    <input
                      value={section.heading}
                      onChange={(e) => updateSection(section.id, { heading: e.target.value })}
                      aria-label={`Judul scene ${i + 1}`}
                      className="w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                      placeholder="Judul scene"
                    />
                    <textarea
                      value={section.body}
                      onChange={(e) => updateSection(section.id, { body: e.target.value })}
                      rows={5}
                      aria-label={`Isi scene ${i + 1}`}
                      className="w-full rounded-lg bg-transparent border border-white/15 px-4 py-2.5 text-sm leading-relaxed text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
                      placeholder="Isi scene..."
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {addOpen && (
            <div className="rounded-xl border border-[#f6d77a]/30 bg-[#f6d77a]/10 p-4 space-y-3">
              <h3 className="text-sm font-medium text-[#fdf3d8]">Tambah Surat</h3>
              <label htmlFor="add-age" className="text-xs text-[#fdf3d8]/80">
                Pilih edisi (usia)
              </label>
              <select
                id="add-age"
                value={addAge}
                onChange={(e) => setAddAge(Number(e.target.value))}
                className="w-full rounded-lg bg-[#0b1226] border border-white/15 px-4 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40"
              >
                {BIRTHDAY_THEMES.map((theme) => (
                  <option key={theme.id} value={theme.age}>
                    Usia {theme.age} · {theme.year} · {theme.title}
                    {savedAges.includes(theme.age) ? " (sudah ada)" : ""}
                  </option>
                ))}
              </select>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={createLetter}
                  className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-6 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
                >
                  Buat / Buka Surat
                </button>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  className="rounded-lg border border-white/15 px-6 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5 transition-colors"
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={openDelete}
        title="Hapus Surat"
        description={
          selectedAge == null
            ? ""
            : `Hapus draf surat untuk usia ${selectedAge}? Hanya surat ini yang terhapus; edisi lain tidak terpengaruh. Tindakan ini tidak dapat dibatalkan.`
        }
        confirmLabel="Hapus"
        cancelLabel="Batal"
        onConfirm={confirmDelete}
        onCancel={() => setOpenDelete(false)}
      />
    </div>
  );
}
