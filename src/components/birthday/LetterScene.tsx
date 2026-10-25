"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import BirthdayAmbientEffects from "./BirthdayAmbientEffects";
import GlitterBurst from "./GlitterBurst";

/**
 * Letter from Ayah — data model + cinematic multi-section reader.
 *
 * This module is shared by three places and therefore keeps the source letter,
 * the paragraph→scene splitter, the browser-only draft storage, and the
 * presentational reader together:
 *   - the birthday experience (public reading),
 *   - the admin letter editor (`/admin/birthday`),
 *   - the `?preview=1&letter=1` draft preview.
 *
 * The letter text is preserved verbatim. A paragraph wrapped entirely in
 * `**…**` is treated as a scene heading; inline `**…**` keeps its emphasis.
 * Nothing is summarised or rewritten.
 */

export type LetterRun = { text: string; bold?: boolean };

export interface LetterSection {
  id: string;
  heading: string;
  /** Paragraphs separated by a blank line. */
  body: string;
}

/**
 * Opening thumbnail frame settings (browser-only draft, like the letter).
 * `src` is empty until a real, publicly-servable photo is provided — the frame
 * then keeps an honest placeholder. Private /api/media uploads are NOT public
 * and must not be referenced here.
 */
export interface LetterThumbnail {
  /** Optional public path, e.g. "/media/vanka-opening.jpg". Empty = placeholder. */
  src?: string;
  alt: string;
  caption?: string;
}

export interface LetterDraft {
  title: string;
  date: string;
  /** The full letter as editable text (paragraphs separated by blank lines). */
  fullText: string;
  sections: LetterSection[];
  /** Optional opening thumbnail settings. */
  thumbnail?: LetterThumbnail;
}

/** Honest default: no photo chosen yet. */
export const DEFAULT_LETTER_THUMBNAIL: LetterThumbnail = {
  alt: "Bingkai foto pembuka Vanka",
  caption: "Belum ada foto pembuka yang dipilih.",
};

/** Split a paragraph into inline runs, honouring `**bold**`. */
export function parseRuns(text: string): LetterRun[] {
  const runs: LetterRun[] = [];
  const re = /\*\*([\s\S]+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index) });
    runs.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length > 0 ? runs : [{ text }];
}

/**
 * Split the full letter into scenes. A paragraph that is *entirely* bold
 * (`**…**`) starts a new scene and becomes its heading; every other paragraph
 * stays in the current scene's body. Lossless: every sentence is kept in order.
 */
export function splitIntoScenes(text: string): LetterSection[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const sections: LetterSection[] = [];
  let current: LetterSection | null = null;

  for (const para of paragraphs) {
    const headingMatch = /^\*\*([\s\S]+)\*\*$/.exec(para);
    if (headingMatch) {
      current = { id: `s${sections.length + 1}`, heading: headingMatch[1].trim(), body: "" };
      sections.push(current);
    } else {
      if (!current) {
        current = { id: "s1", heading: "", body: "" };
        sections.push(current);
      }
      current.body = current.body ? `${current.body}\n\n${para}` : para;
    }
  }

  return sections.map((section, i) => ({
    ...section,
    id: `s${i + 1}`,
    heading: section.heading || `Bagian ${i + 1}`,
  }));
}

/** Source letter, exactly as provided by Ayah (paragraphs separated by blanks). */
export const DEFAULT_LETTER_TEXT = `**Selamat ulang tahun yang pertama, Vanka sayang.**

27 Oktober 2026.

Hari ini, genap satu tahun sejak Tuhan mempercayakan kamu hadir di dunia ini. Satu tahun yang mungkin belum bisa kamu ingat ketika kamu besar nanti, tetapi akan selalu Ayah simpan di tempat paling istimewa dalam hati Ayah.

Nak, kamu mungkin belum mengerti arti kata cinta. Kamu mungkin belum bisa membaca tulisan ini. Kamu bahkan belum tahu betapa banyak hal yang Ayah pikirkan setiap hari demi melihat kamu tumbuh bahagia.

Tapi Ayah ingin kamu tahu satu hal.

**Sejak kamu hadir dalam hidup Ayah, dunia Ayah tidak lagi sama.**

Ada sepasang mata kecil yang harus Ayah jaga. Ada senyum mungil yang bisa membuat hari berat terasa lebih ringan. Ada tangan kecil yang mungkin belum mengerti apa-apa, tetapi selalu punya cara untuk membuat Ayah merasa bahwa hidup ini masih begitu indah.

Vanka, Sayang…

Mungkin ketika kamu membaca surat ini nanti, kamu sudah bisa berlari. Mungkin kamu sudah masuk sekolah, punya banyak teman, punya mimpi-mimpi besar, dan mulai mengenal dunia yang jauh lebih luas daripada pelukan Ayah.

Mungkin suatu hari kamu juga akan bertanya mengapa perjalanan hidup kita tidak sama seperti keluarga lainnya.

Ayah tidak tahu pertanyaan apa yang akan kamu ajukan kelak. Tapi Ayah ingin kamu tumbuh tanpa merasa bahwa kamu harus menanggung kesedihan orang dewasa.

**Kamu tidak pernah menjadi kesalahan. Kamu tidak pernah menjadi beban. Dan kamu tidak perlu melakukan apa pun untuk membuat dirimu pantas dicintai.**

Kamu dicintai karena kamu adalah Vanka.

Putri kecil Ayah yang begitu berharga.

Maaf kalau dalam perjalanan kita nanti, Ayah tidak selalu punya jawaban untuk semuanya. Maaf kalau suatu hari Ayah terlihat lelah, kalau Ayah belum bisa memberikan semua yang kamu inginkan, atau kalau ada saatnya Ayah harus belajar lagi bagaimana menjadi ayah yang lebih baik.

Ayah memang tidak sempurna, Nak.

Tetapi Ayah berjanji akan terus belajar. Ayah akan berusaha menjadi tempat kamu pulang ketika dunia terasa melelahkan. Ayah akan berusaha mendengarkanmu ketika kamu ingin bercerita, memelukmu ketika kamu sedih, dan mendukungmu ketika kamu berani mengejar impianmu.

Ayah tidak ingin kamu tumbuh hanya menjadi anak yang kuat. Ayah ingin kamu tahu bahwa kamu juga boleh menangis, boleh takut, boleh gagal, dan boleh meminta pertolongan.

Karena kamu tidak harus menghadapi semuanya sendirian.

Nak, kalau suatu hari kamu membaca surat ini ketika Ayah sudah mulai menua, ingatlah bahwa pernah ada seorang ayah yang memandangi bayi kecilnya dan berdoa dalam diam agar Tuhan memberinya kekuatan untuk membesarkanmu dengan baik.

Seorang ayah yang mungkin tidak selalu pandai mengungkapkan perasaannya, tetapi selalu punya alasan untuk terus berusaha: **kamu.**

Terima kasih sudah hadir dalam hidup Ayah, Vanka.

Terima kasih sudah memberikan Ayah kesempatan untuk mengenal cinta yang begitu besar, cinta yang membuat Ayah ingin menjadi manusia yang lebih baik setiap harinya.

Ayah tidak bisa menjanjikan bahwa hidupmu akan selalu mudah. Tetapi Ayah berdoa agar kamu selalu memiliki hati yang baik, keberanian untuk menghadapi dunia, kebijaksanaan dalam mengambil keputusan, dan iman yang menolongmu ketika kamu tidak tahu harus melangkah ke mana.

Kiranya Tuhan Yesus selalu menjaga setiap langkahmu, Nak. Kiranya tangan-Nya menyertaimu ketika Ayah tidak bisa berada di sampingmu. Dan kiranya kamu selalu menemukan alasan untuk tersenyum, bahkan setelah melewati hari-hari yang sulit.

**Selamat ulang tahun pertama, Vanka, cinta hati Ayah.**

Kalau suatu hari kamu bertanya apa hadiah paling berharga yang pernah Ayah terima dalam hidup ini, Ayah tidak perlu berpikir lama untuk menjawabnya.

Itu adalah kesempatan untuk menjadi ayahmu.

Dan kalau kamu bertanya apa yang paling Ayah inginkan untukmu, jawabannya sederhana.

Ayah ingin kamu bahagia. Ayah ingin kamu tumbuh dengan hati yang tenang. Ayah ingin kamu tahu bahwa kamu berharga, bahwa hidupmu berarti, dan bahwa kamu selalu boleh bermimpi setinggi langit.

Tumbuhlah, Sayang.

Jelajahi dunia. Kejarlah impianmu. Jadilah dirimu sendiri.

Tidak perlu menjadi sempurna untuk membuat Ayah bangga.

Cukup bertumbuh menjadi Vanka yang baik, bahagia, dan tahu bahwa dirinya dicintai.

**Dari tangan kecilmu yang dulu menggenggam jari Ayah, sampai tanganmu kelak yang mungkin sudah lebih besar daripada tangan Ayah… kamu akan selalu menjadi putri kecil Ayah.**

Selamat ulang tahun, anakku.

Ayah menyayangimu hari ini, esok, dan selama Tuhan masih memberikan Ayah kesempatan untuk mencintaimu.

**Dengan seluruh cinta yang Ayah punya,**

**Ayah, yang akan selalu berusaha menjadi rumah bagimu.** ❤️`;

export const DEFAULT_LETTER_DRAFT: LetterDraft = {
  title: "Untuk Vanka, Putri Kecil Ayah",
  date: "27 Oktober 2026",
  fullText: DEFAULT_LETTER_TEXT,
  sections: splitIntoScenes(DEFAULT_LETTER_TEXT),
  thumbnail: DEFAULT_LETTER_THUMBNAIL,
};

/** Preview with no saved draft must show a message — never fabricated text. */
export const EMPTY_LETTER_DRAFT: LetterDraft = {
  title: "",
  date: "",
  fullText: "",
  sections: [],
  thumbnail: DEFAULT_LETTER_THUMBNAIL,
};

/* ------------------------------------------------------------------------- */
/* Browser-only draft storage (localStorage). Nothing is sent to a server.    */
/* ------------------------------------------------------------------------- */

export const LETTER_DRAFT_KEY = "vanka.letter.draft.v1";

export function loadLetterDraft(): LetterDraft | null {
  try {
    const raw = window.localStorage.getItem(LETTER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LetterDraft;
    if (!parsed || !Array.isArray(parsed.sections)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLetterDraft(draft: LetterDraft): void {
  try {
    window.localStorage.setItem(LETTER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be unavailable (private mode / quota) — the editor still works.
  }
}

/* ------------------------------------------------------------------------- */
/* Per-edition letter storage (localStorage).                                 */
/*                                                                            */
/* Keyed by edition age (1–17) so a letter for one edition NEVER overwrites    */
/* another. The public experience reads the age it is previewing. Age 1 also   */
/* falls back to the legacy single-draft key (`LETTER_DRAFT_KEY`) so existing  */
/* drafts keep working.                                                       */
/* ------------------------------------------------------------------------- */

export const LETTERS_STORE_KEY = "vanka.letters.v2";

export type LetterStore = Record<string, LetterDraft>;

function isLetterDraft(value: unknown): value is LetterDraft {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as LetterDraft).title === "string" &&
    Array.isArray((value as LetterDraft).sections)
  );
}

export function loadLetterStore(): LetterStore {
  try {
    const raw = window.localStorage.getItem(LETTERS_STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LetterStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isLetterDraft(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLetterStore(store: LetterStore): void {
  try {
    window.localStorage.setItem(LETTERS_STORE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private mode / quota) — the caller still holds edits.
  }
}

/** Saved letter for an edition age (1–17), or null. Age 1 is legacy-aware. */
export function loadLetterForAge(age: number): LetterDraft | null {
  const store = loadLetterStore();
  const key = String(age);
  if (store[key]) return store[key];
  if (age === 1) return loadLetterDraft();
  return null;
}

export function saveLetterForAge(age: number, draft: LetterDraft): void {
  const store = loadLetterStore();
  store[String(age)] = draft;
  writeLetterStore(store);
}

/** Delete only the selected edition's letter. */
export function deleteLetterForAge(age: number): void {
  const store = loadLetterStore();
  if (store[String(age)]) {
    delete store[String(age)];
    writeLetterStore(store);
  }
  if (age === 1) {
    // Clear the legacy age-1 key too, so a deleted letter cannot reappear.
    try {
      window.localStorage.removeItem(LETTER_DRAFT_KEY);
    } catch {
      // ignore
    }
  }
}

/** Ages (1–17) that currently have a saved letter draft, ascending. */
export function listSavedLetterAges(): number[] {
  const store = loadLetterStore();
  const ages = new Set<number>();
  for (const key of Object.keys(store)) {
    const age = Number(key);
    if (Number.isInteger(age) && age >= 1 && age <= 17) ages.add(age);
  }
  if (!store["1"] && loadLetterDraft()) ages.add(1);
  return Array.from(ages).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------- */
/* Reader                                                                     */
/* ------------------------------------------------------------------------- */

interface LetterSceneProps {
  draft?: LetterDraft;
  preview?: boolean;
  /** Called when the reader reaches the last section and continues. */
  onFinish?: () => void;
}

export default function LetterScene({ draft, preview = false, onFinish }: LetterSceneProps) {
  const reduce = useReducedMotion();
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  // In preview we land straight on the letter (no envelope), so the edited
  // content is visible immediately.
  const [opened, setOpened] = useState(preview);
  const [index, setIndex] = useState(0);

  const active = draft ?? DEFAULT_LETTER_DRAFT;
  const sections = active.sections;

  function handleOpen() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    // Guarantees the letter opens even with reduced motion / a stalled animation.
    window.setTimeout(() => setOpened(true), reduce ? 150 : 1100);
  }

  if (sections.length === 0) {
    return (
      <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-3xl border border-[#e9c67c]/25 bg-[#0a1330]/80 p-8 text-center">
        <span className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.4em] text-[#e9c67c]">
          Surat dari Ayah
        </span>
        <p className="font-serif text-base text-white/80">
          {preview ? "Draf surat tidak ditemukan di browser ini." : "Surat belum tersedia."}
        </p>
        <p className="font-sans text-xs text-white/55">
          Buka editor “Surat untuk Vanka” di panel admin, lalu tekan “Preview Surat”. Tidak ada surat
          rekaan yang ditampilkan.
        </p>
      </div>
    );
  }

  const safeIndex = Math.min(index, sections.length - 1);
  const section = sections[safeIndex];
  const total = sections.length;
  const isLast = safeIndex === total - 1;

  const sectionMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -10 } };

  return (
    <div className="flex w-full flex-col items-center gap-8">
      {/*
        Full-screen glitter while the envelope opens — the same transition as the
        gift box, so the two openings feel like one language.
      */}
      {!opened && <BirthdayAmbientEffects />}
      <GlitterBurst active={opening} durationMs={reduce ? 350 : 1100} seed={0x4c455454} count={110} />

      <div className="flex flex-col items-center gap-3 text-center">
        <span className="font-sans text-[0.7rem] font-semibold uppercase tracking-[0.45em] text-[#e9c67c]">
          Surat dari Ayah
        </span>
        <h2 className="text-shadow-lg max-w-2xl font-display text-2xl leading-snug text-[#f6e3b2] sm:text-4xl">
          {active.title || "Surat untuk Vanka"}
        </h2>
        {active.date && <p className="font-serif text-sm italic text-white/60">{active.date}</p>}
      </div>

      <AnimatePresence mode="wait">
        {!opened ? (
          <motion.div
            key="envelope"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
            className="flex flex-col items-center gap-6"
          >
            <div aria-hidden="true" className="relative h-40 w-64 sm:h-48 sm:w-80" style={{ perspective: 800 }}>
              <div className="absolute inset-0 rounded-lg border border-[#e9c67c]/40 bg-gradient-to-b from-[#16264d] to-[#0a1330] shadow-[0_24px_50px_-24px_rgba(0,0,0,0.9)]" />
              <motion.div
                className="absolute inset-x-6 top-5 h-3/4 rounded-sm bg-gradient-to-b from-[#f7f1df] to-[#e6d9b8]"
                initial={false}
                animate={opening ? { y: -26 } : { y: 0 }}
                transition={{ duration: reduce ? 0 : 0.6, delay: reduce ? 0 : 0.35, ease: "easeOut" }}
              />
              <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#e9c67c]/60 bg-gradient-to-br from-[#f6e3b2] to-[#c99b53] shadow-[0_0_18px_rgba(233,198,124,0.6)]" />
              <motion.div
                className="absolute inset-x-0 top-0 h-1/2 origin-top"
                animate={opening ? { rotateX: -165 } : { rotateX: 0 }}
                transition={{ duration: reduce ? 0 : 0.7, ease: "easeInOut" }}
                style={{ transformStyle: "preserve-3d" }}
              >
                <div
                  className="h-full w-full border-b border-[#e9c67c]/25 bg-gradient-to-b from-[#24407f] to-[#0d1834]"
                  style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
                />
              </motion.div>
            </div>

            <button
              type="button"
              onClick={handleOpen}
              disabled={opening}
              aria-label="Buka surat ulang tahun dari Ayah"
              className="inline-flex items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-9 py-4 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {opening ? "Membuka…" : "Buka Surat"}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="letter"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.7, ease: "easeOut" }}
            className="w-full max-w-2xl rounded-3xl border border-[#e9c67c]/25 bg-[#0a1330]/80 p-6 text-left shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-10"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-[#e9c67c]">
                Bagian {safeIndex + 1} dari {total}
              </span>
              <span className="font-sans text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                Progres membaca
              </span>
            </div>

            <div className="mb-6 flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={safeIndex + 1} aria-label="Progres membaca surat">
              {sections.map((s, i) => (
                <span
                  key={s.id}
                  aria-hidden="true"
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i === safeIndex ? "w-6 bg-gradient-to-r from-[#c99b53] to-[#f6e3b2]" : "w-1.5 bg-white/25"
                  }`}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={safeIndex}
                initial={sectionMotion.initial}
                animate={sectionMotion.animate}
                exit={sectionMotion.exit}
                transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
              >
                {section.heading && (
                  <h3 className="mb-4 font-display text-xl leading-snug text-[#f6e3b2] sm:text-2xl">
                    {section.heading}
                  </h3>
                )}
                <div className="space-y-4 font-serif text-[0.98rem] leading-relaxed text-white/85 sm:text-base sm:leading-8">
                  {section.body
                    .split(/\n\s*\n/)
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0)
                    .map((para, pi) => (
                      <p key={pi}>
                        {parseRuns(para).map((run, ri) =>
                          run.bold ? (
                            <strong key={ri} className="font-semibold text-[#f6e3b2]">
                              {run.text}
                            </strong>
                          ) : (
                            <span key={ri}>{run.text}</span>
                          ),
                        )}
                      </p>
                    ))}
                </div>
              </motion.div>
            </AnimatePresence>

            {isLast && (
              <div className="mt-8 flex items-center justify-end border-t border-[#e9c67c]/20 pt-6">
                <span className="font-script text-3xl text-[#f6e3b2]">Ayah</span>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                disabled={safeIndex === 0}
                aria-label="Bagian surat sebelumnya"
                className="rounded-full border border-white/20 px-5 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35"
              >
                ← Kembali
              </button>
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(i + 1, total - 1))}
                disabled={isLast}
                aria-label="Bagian surat selanjutnya"
                className="rounded-full border border-white/20 px-5 py-2.5 font-sans text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition duration-300 hover:border-[#e9c67c] hover:text-[#f6e3b2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9c67c] disabled:cursor-not-allowed disabled:opacity-35"
              >
                Lanjut →
              </button>
            </div>

            {isLast && onFinish && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={onFinish}
                  className="inline-flex items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-7 py-3.5 font-sans text-xs font-bold uppercase tracking-[0.24em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] active:scale-[0.98]"
                >
                  Lanjut ke Kotak Kenangan →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
