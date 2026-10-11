import type { Metadata } from "next";
import ChapterShell from "@/components/ChapterShell";

export const metadata: Metadata = {
  title: "Memory Archive · Vanka Universe",
  description:
    "An informative placeholder for the Memory Archive chapter — where memories will one day be kept.",
};

const WILL_HOLD = [
  "Photos and moments from every chapter of your life.",
  "Notes and letters written on the days that mattered.",
  "Milestones marked like constellations in your personal sky.",
];

const STATUS: Array<{ label: string; state: string; done: boolean }> = [
  {
    label: "This informative placeholder page",
    state: "Live",
    done: true,
  },
  {
    label: "Browsing and writing memories",
    state: "Not implemented",
    done: false,
  },
  {
    label: "Uploads and permanent storage",
    state: "Not implemented",
    done: false,
  },
  {
    label: "Archive security and private access",
    state: "Not implemented",
    done: false,
  },
];

export default function MemoryArchivePage() {
  return (
    <ChapterShell
      eyebrow="Chapter Two"
      statusLabel="Being prepared"
      title="Memory Archive"
      lead={
        "The place where our memories will one day live together — photos, notes, milestones, and everything worth remembering."
      }
      nextChapter={{ href: "/birthday-experience", label: "Birthday Experience" }}
    >
      <section className="flex flex-col gap-5">
        <h2 className="font-display text-2xl text-[#f6e3b2] sm:text-3xl">
          What this archive will hold
        </h2>
        <ul className="flex flex-col gap-4">
          {WILL_HOLD.map((item, index) => (
            <li
              key={item}
              className="backdrop-blur-glass flex gap-5 rounded-2xl p-6 sm:p-7"
            >
              <span className="font-display text-lg text-[#e9c67c]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="font-serif leading-relaxed text-white/75">
                {item}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="font-display text-2xl text-[#f6e3b2] sm:text-3xl">
          Honest status
        </h2>
        <ul className="flex flex-col gap-3 font-sans text-sm leading-relaxed text-white/75 sm:text-base">
          {STATUS.map((item) => (
            <li key={item.label} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                  item.done ? "bg-[#7ee0a3]" : "bg-[#e9c67c]"
                }`}
              />
              <span>
                {item.label} —{" "}
                <span
                  className={
                    item.done ? "text-[#7ee0a3]" : "text-[#f6e3b2]"
                  }
                >
                  {item.state}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="rounded-r-xl border-l-2 border-[#e9c67c] bg-[#e9c67c]/10 p-6">
          <p className="font-serif leading-relaxed text-white/80">
            {
              "Nothing is stored today. There is no upload flow, no database, and no security layer behind this page — no personal photos of Vanka are used anywhere in this project yet. These features arrive in a later phase, and this page will say so plainly until then."
            }
          </p>
        </div>
      </section>
    </ChapterShell>
  );
}
