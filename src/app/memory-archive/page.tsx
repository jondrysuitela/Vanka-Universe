import type { Metadata } from "next";
import ChapterShell from "@/components/ChapterShell";
import EditionArchive from "@/components/birthday/EditionArchive";

export const metadata: Metadata = {
  title: "Memory Archive · Vanka Universe",
  description:
    "Every birthday Vanka has had, kept year by year — each one replayable in its own theme.",
};

/**
 * Memory Archive — the home of the birthday experiences.
 *
 * From the day AFTER each birthday, that year's Vanka Experience lives here and
 * the public can replay it any time. One chapter per year, ordered newest first,
 * each dressed in that year's theme (see `EditionArchive` / `public-editions.ts`).
 *
 * The reveal rule is applied on the visitor's clock inside `EditionArchive`, so
 * a year only appears once its own birthday has happened.
 */
export default function MemoryArchivePage() {
  return (
    <ChapterShell
      eyebrow="Chapter Two · A chapter for every year"
      statusLabel="Birthday archive"
      title="Memory Archive"
      lead="Setiap ulang tahun Vanka punya satu bab di sini. Mulai dari hari setelah ulang tahunnya, pengalaman tahun itu dapat diputar ulang kapan saja oleh siapa pun."
      nextChapter={{ href: "/birthday-experience", label: "Birthday Experience" }}
    >
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-2xl text-[#f6e3b2] sm:text-3xl">
          Satu bab untuk setiap ulang tahun
        </h2>
        <p className="font-serif leading-relaxed text-white/75">
          Urutannya dari tahun terbaru ke tahun paling awal, dan tampilan setiap
          bab mengikuti tema tahun itu sendiri. Sebuah tahun hanya muncul setelah
          tanggal ulang tahunnya tiba — tidak ada yang dibuka lebih awal.
        </p>
      </section>

      <EditionArchive />
    </ChapterShell>
  );
}
