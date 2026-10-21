"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";

const PIN_LENGTH = 6;

export default function IPhonePinOverlay({
  onUnlocked,
  notice,
}: {
  onUnlocked: () => void;
  notice?: string;
}) {
  const [digits, setDigits] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const shakeRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear the pending shake timer when the overlay goes away.
  //
  // NOTE: this overlay only renders while the archive is LOCKED, so there is no
  // visitor session to revoke here. The auto-lock on leaving the page lives in
  // the page component (`src/app/arsip-ibu/page.tsx`), which also covers the
  // UNLOCKED state.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const pin = digits.join("");
  const complete = pin.length === PIN_LENGTH;

  function addDigit(digit: string) {
    if (submitting || digits.length >= PIN_LENGTH) return;
    setDigits((prev) => [...prev, digit]);
    setError(null);
  }

  function removeDigit() {
    if (submitting || digits.length === 0) return;
    setDigits((prev) => prev.slice(0, -1));
  }

  function triggerShake() {
    shakeRef.current = true;
    setShake(true);
    setTimeout(() => {
      shakeRef.current = false;
      setShake(false);
    }, 500);
  }

  async function handleSubmit() {
    if (submitting || !complete) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/archive/access", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({ pin }),
      });

      if (response.ok) {
        setDigits([]);
        onUnlocked();
        return;
      }

      if (response.status === 401) {
        setError("PIN salah. Coba lagi.");
        triggerShake();
      } else if (response.status === 429) {
        setError("Terlalu banyak percobaan. Tunggu beberapa saat.");
      } else if (response.status === 503) {
        setError("Sistem tidak siap. Coba lagi nanti.");
      } else {
        setError("Gagal membuka arsip.");
      }
      setDigits([]);
    } catch {
      setError("Tidak dapat terhubung ke server.");
      triggerShake();
      setDigits([]);
    } finally {
      setSubmitting(false);
    }
  }

  const numbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex flex-1 items-center justify-center px-4"
    >
      <motion.div
        animate={shake ? { x: [-10, 10, -10, 10, 0] } : {}}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <div className="space-y-8">
          {/* Header */}
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="rounded-full border border-[#e9c67c]/45 bg-[#0b1226]/70 px-4 py-1.5 font-sans text-[0.65rem] uppercase tracking-[0.35em] text-[#f6e3b2] backdrop-blur-md">
              Arsip Privat
            </span>
            <h1 className="text-shadow-lg font-display text-3xl text-[#f6e3b2] sm:text-4xl">
              Arsip Ibu
            </h1>
            <p className="font-serif text-sm leading-relaxed text-white/70">
              Masukkan PIN untuk membukanya
            </p>
          </div>

          {/* Notice */}
          {notice && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-[#e9c67c]/30 bg-[#e9c67c]/10 px-4 py-3 text-center text-sm text-[#f0d9a4]"
            >
              {notice}
            </motion.p>
          )}

          {/*
            The PIN entry area is a labelled GROUP: assistive technology
            announces it as "PIN", and the page-level test asserts that group
            exists to prove the gate (not the experience) is on screen.
          */}
          <div
            role="group"
            aria-label="PIN"
            className="flex flex-col items-center gap-4"
          >
            {/* PIN Dots */}
            <div className="flex justify-center gap-3 sm:gap-4">
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0.8 }}
                  animate={{
                    scale: i < digits.length ? 1.2 : 1,
                    backgroundColor:
                      i < digits.length ? "#f6d77a" : "rgba(255,255,255,0.1)",
                  }}
                  transition={{ duration: 0.2 }}
                  className="h-4 w-4 rounded-full border border-white/20"
                />
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200"
            >
              {error}
            </motion.p>
          )}

          {/* Numeric Keypad */}
          <div className="space-y-3">
            {/* Rows 1-3 */}
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex justify-center gap-3 sm:gap-4">
                {numbers.slice(row * 3, (row + 1) * 3).map((num) => (
                  <motion.button
                    key={num}
                    type="button"
                    onClick={() => addDigit(num)}
                    disabled={submitting || digits.length >= PIN_LENGTH}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-white/15 bg-white/5 font-sans text-2xl font-semibold text-[#f6e3b2] transition hover:border-[#f6d77a]/60 hover:bg-white/10 disabled:opacity-50 sm:h-[72px] sm:w-[72px]"
                  >
                    {num}
                  </motion.button>
                ))}
              </div>
            ))}

            {/* Row 4: 0, Delete, Submit */}
            <div className="flex justify-center gap-3 sm:gap-4">
              {/* 0 */}
              <motion.button
                type="button"
                onClick={() => addDigit("0")}
                disabled={submitting || digits.length >= PIN_LENGTH}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-white/15 bg-white/5 font-sans text-2xl font-semibold text-[#f6e3b2] transition hover:border-[#f6d77a]/60 hover:bg-white/10 disabled:opacity-50 sm:h-[72px] sm:w-[72px]"
              >
                0
              </motion.button>

              {/* Delete */}
              <motion.button
                type="button"
                onClick={removeDigit}
                disabled={submitting || digits.length === 0}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-white/15 bg-white/5 font-sans text-xl font-semibold text-red-300/70 transition hover:border-red-300/60 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50 sm:h-[72px] sm:w-[72px]"
              >
                ⌫
              </motion.button>

              {/* Submit */}
              <motion.button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !complete}
                whileHover={complete && !submitting ? { scale: 1.1 } : {}}
                whileTap={complete && !submitting ? { scale: 0.95 } : {}}
                className="flex h-[60px] w-[60px] items-center justify-center rounded-full border border-[#f6d77a]/60 bg-gradient-to-b from-[#f7e6bb] to-[#d8ab5e] font-sans text-lg font-bold text-[#20160a] shadow-[0_8px_24px_-12px_rgba(233,198,124,0.6)] transition disabled:opacity-50 sm:h-[72px] sm:w-[72px]"
              >
                {submitting ? "…" : "✓"}
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.section>
  );
}
