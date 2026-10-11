"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastType = "success" | "info" | "warning" | "error";

export type Toast = {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  duration?: number;
};

type ToastContextValue = {
  showToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const duration = toast.duration ?? 3500;
      const next: Toast = { ...toast, id };
      setToasts((prev) => [...prev, next]);
      if (duration > 0) {
        const timer = setTimeout(() => removeToast(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [removeToast]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-label="Notifikasi admin" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-3 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="rounded-xl border border-white/10 bg-[#0b1226]/95 backdrop-blur-xl p-4 shadow-lg text-[#f8fafc] motion-reduce:transition-none motion-safe:transition-all motion-safe:duration-300"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#fdf3d8]">{t.title}</div>
                {t.message && <div className="text-xs text-[#fdf3d8]/80 mt-1 leading-relaxed">{t.message}</div>}
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Tutup notifikasi"
                className="text-[#fdf3d8]/60 hover:text-[#fdf3d8] text-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
