"use client";

import Link from "next/link";
import { useId, useState } from "react";

import {
  MIN_ADMIN_PASSWORD_LENGTH,
  passwordChangeMessage,
  validatePasswordChange,
} from "@/lib/auth/password-policy";

/**
 * Admin password change form (Tahap VU-ARCHIVE-ACCESS-4C).
 *
 * Collects the CURRENT password plus the new password and its confirmation, and
 * calls `PUT /api/auth/password` with the required CSRF headers. The browser
 * validates for instant feedback only; the server re-validates and
 * re-authenticates. The success is only shown after the server confirms (2xx).
 *
 * SECRETS: passwords live in component state only — never localStorage,
 * sessionStorage, the URL, or logs. Because a password change revokes every
 * session (including this one), the success state points to the login page.
 */

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;
  if (response.status === 401) return "Kata sandi saat ini salah.";
  if (response.status === 403) return "Permintaan ditolak. Muat ulang halaman lalu coba lagi.";
  if (response.status === 422) return body?.error?.message ?? "Input tidak valid.";
  if (response.status === 429) return "Terlalu banyak percobaan. Coba lagi nanti.";
  if (response.status === 503) return "Layanan belum siap. Coba lagi nanti.";
  return "Gagal mengubah kata sandi. Coba lagi.";
}

export default function AdminPasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const invalid = validatePasswordChange({ currentPassword, newPassword, confirmPassword });
    if (invalid) {
      setStatus({ kind: "error", message: passwordChangeMessage(invalid) });
      return;
    }

    setSubmitting(true);
    setStatus({ kind: "idle" });
    try {
      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-vanka-request": "1" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      if (response.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setStatus({
          kind: "success",
          message:
            "Kata sandi diperbarui. Semua sesi (termasuk sesi ini) diakhiri — silakan masuk kembali dengan kata sandi baru.",
        });
        setSubmitting(false);
        return;
      }

      setStatus({ kind: "error", message: await readErrorMessage(response) });
      setSubmitting(false);
    } catch {
      setStatus({ kind: "error", message: "Tidak dapat menghubungi server. Coba lagi." });
      setSubmitting(false);
    }
  }

  return (
    <form className="w-full max-w-md space-y-4" onSubmit={handleSubmit} aria-busy={submitting}>
      <div>
        <label htmlFor={currentId} className="text-sm text-[#fdf3d8]/80">
          Kata Sandi Saat Ini
        </label>
        <input
          id={currentId}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
      </div>

      <div>
        <label htmlFor={newId} className="text-sm text-[#fdf3d8]/80">
          Kata Sandi Baru
        </label>
        <input
          id={newId}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-[#fdf3d8]/50">
          Minimal {MIN_ADMIN_PASSWORD_LENGTH} karakter.
        </p>
      </div>

      <div>
        <label htmlFor={confirmId} className="text-sm text-[#fdf3d8]/80">
          Konfirmasi Kata Sandi Baru
        </label>
        <input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
      </div>

      {status.kind === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {status.message}
        </p>
      )}

      {status.kind === "success" && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
        >
          <p>{status.message}</p>
          <Link href="/admin/login" className="inline-block underline hover:text-emerald-50">
            Ke halaman masuk
          </Link>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-6 text-sm font-medium text-[#050814] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Menyimpan…" : "Ubah Kata Sandi"}
      </button>
    </form>
  );
}
