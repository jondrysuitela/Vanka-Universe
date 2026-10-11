"use client";

import { useId, useRef, useState } from "react";

import {
  ARCHIVE_PIN_UI_LENGTH,
  accessErrorMessage,
  mapAccessOutcome,
} from "@/lib/archive/visitor";

/**
 * Arsip Privat — six-digit PIN gate (Tahap VU-ARCHIVE-ACCESS-4C-UI).
 *
 * Renders six responsive digit boxes and submits the concatenated digits to
 * `POST /api/archive/access` with the required CSRF headers. Six digits is a
 * presentational choice WITHIN the unchanged server policy (4–12 digits); the
 * value sent is exactly what the visitor typed — never truncated or altered.
 *
 * The PIN is held in component state only: NEVER localStorage, sessionStorage,
 * the URL, or logs. Inputs are masked (`type="password"`) and error messages are
 * generic — the full PIN is never echoed anywhere. The archive is only reported
 * as open after the SERVER confirms success (2xx → `onUnlocked`).
 */

const PIN_LENGTH = ARCHIVE_PIN_UI_LENGTH;

export default function ArchivePinGate({
  onUnlocked,
  notice,
}: {
  onUnlocked: () => void;
  /** Optional neutral notice (e.g. "session ended"). Never an error. */
  notice?: string;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(PIN_LENGTH).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const errorId = useId();

  const pin = digits.join("");
  const complete = pin.length === PIN_LENGTH;

  function focusBox(index: number) {
    const target = inputsRef.current[Math.max(0, Math.min(index, PIN_LENGTH - 1))];
    if (target) target.focus();
  }

  function setDigitsFrom(startIndex: number, chars: string) {
    setDigits((previous) => {
      const next = [...previous];
      for (let i = 0; i < chars.length && startIndex + i < PIN_LENGTH; i += 1) {
        next[startIndex + i] = chars[i];
      }
      return next;
    });
    focusBox(startIndex + chars.length);
  }

  function handleChange(index: number, raw: string) {
    const cleaned = raw.replace(/\D/g, "");
    if (cleaned.length === 0) {
      setDigits((previous) => {
        const next = [...previous];
        next[index] = "";
        return next;
      });
      return;
    }
    // Spread forward when a box receives more than one digit (autofill/paste).
    setDigitsFrom(index, cleaned);
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      if (digits[index]) {
        event.preventDefault();
        setDigits((previous) => {
          const next = [...previous];
          next[index] = "";
          return next;
        });
      } else if (index > 0) {
        event.preventDefault();
        setDigits((previous) => {
          const next = [...previous];
          next[index - 1] = "";
          return next;
        });
        focusBox(index - 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight" && index < PIN_LENGTH - 1) {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData?.getData("text") ?? "";
    const cleaned = pasted.replace(/\D/g, "");
    if (cleaned.length === 0) return;
    event.preventDefault();
    if (cleaned.length >= PIN_LENGTH) {
      setDigits(cleaned.slice(0, PIN_LENGTH).split(""));
      focusBox(PIN_LENGTH - 1);
      return;
    }
    setDigitsFrom(index, cleaned);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const value = digits.join("");
    if (value.length !== PIN_LENGTH) {
      setError(`Masukkan ${PIN_LENGTH} digit PIN.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/archive/access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({ pin: value }),
      });

      const outcome = mapAccessOutcome(response.status);
      if (outcome === "unlocked") {
        // Drop the PIN from memory before leaving the gate.
        setDigits(Array<string>(PIN_LENGTH).fill(""));
        onUnlocked();
        return;
      }

      setError(accessErrorMessage(outcome));
      setSubmitting(false);
    } catch {
      setError(accessErrorMessage("error"));
      setSubmitting(false);
    }
  }

  return (
    <section className="flex flex-1 items-center justify-center">
      <div className="backdrop-blur-glass w-full max-w-md rounded-3xl p-8 sm:p-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-4 py-1.5 font-sans text-[0.65rem] uppercase tracking-[0.35em] text-[#f6e3b2] backdrop-blur-md">
            Arsip Privat
          </span>
          <h1 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-4xl">
            Arsip Ibu
          </h1>
          <p className="font-serif text-base leading-relaxed text-white/75">
            Arsip ini hanya untuk keluarga. Masukkan PIN untuk membukanya.
          </p>
        </header>

        {notice && (
          <p
            role="status"
            className="mt-6 rounded-2xl border border-[#e9c67c]/30 bg-[#e9c67c]/10 px-4 py-3 text-center text-sm text-[#f0d9a4]"
          >
            {notice}
          </p>
        )}

        <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit} aria-busy={submitting}>
          <fieldset
            className="m-0 border-0 p-0"
            aria-describedby={error ? errorId : undefined}
          >
            <legend className="mb-3 block w-full text-center font-sans text-xs uppercase tracking-[0.25em] text-white/70">
              PIN
            </legend>
            <div className="flex justify-center gap-2 sm:gap-3">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(element) => {
                    inputsRef.current[index] = element;
                  }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  aria-label={`Digit PIN ke-${index + 1}`}
                  disabled={submitting}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => handleChange(index, event.target.value)}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  onPaste={(event) => handlePaste(index, event)}
                  className="h-14 w-10 rounded-xl border border-white/15 bg-transparent text-center font-sans text-2xl text-[#f8fafc] focus:border-[#f6d77a]/60 focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/50 disabled:opacity-60 sm:h-16 sm:w-12"
                />
              ))}
            </div>
          </fieldset>

          {error && (
            <p
              id={errorId}
              role="alert"
              className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !complete}
            className="inline-flex w-full items-center justify-center gap-3 rounded-full bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] px-8 py-3.5 font-sans text-xs font-bold uppercase tracking-[0.28em] text-[#20160a] shadow-[0_14px_45px_-15px_rgba(233,198,124,0.75)] transition duration-300 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f6e3b2] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Membuka…" : "Buka Arsip"}
          </button>
        </form>
      </div>
    </section>
  );
}
