"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Lanjut",
  cancelLabel = "Batal",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => {
      cancelAnimationFrame(id);
      setMounted(false);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? "confirm-desc" : undefined}
        className="relative w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/10 bg-[#0b1226]/95 backdrop-blur-xl p-6 shadow-xl text-[#f8fafc] motion-reduce:transition-none motion-safe:transition-all motion-safe:duration-200"
      >
        <h2 id="confirm-title" className="text-lg font-display text-[#fdf3d8]">
          {title}
        </h2>
        {description && (
          <p id="confirm-desc" className="text-sm text-[#fdf3d8]/80 mt-2 leading-relaxed">
            {description}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-[#fdf3d8]/90 hover:bg-white/5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-4 py-2.5 text-sm font-medium hover:opacity-95"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
