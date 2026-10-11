"use client";

import { useId, useState } from "react";

import {
  ARCHIVE_PIN_MAX_LENGTH,
  ARCHIVE_PIN_MIN_LENGTH,
  ARCHIVE_PIN_PATTERN,
} from "@/lib/archive/access/policy";

/**
 * Private-archive PIN change form (Tahap VU-ARCHIVE-ACCESS-4C).
 *
 * Authorizes with the CURRENT admin password (same channel as the API) and calls
 * `PUT /api/archive/access/pin`. The PIN is a SEPARATE credential from the admin
 * password: this never changes the password, and the password is only used to
 * authorize the change.
 *
 * SECRETS: the PIN and password live in component state only — never
 * localStorage, sessionStorage, the URL, or logs. The response's `accessVersion`
 * is intentionally not displayed (it is internal). Changing the PIN bumps
 * `access_version`, which invalidates every active visitor session, so the copy
 * says so plainly.
 */

function validate(pin: string, confirmPin: string, currentPassword: string): string | null {
  if (currentPassword.length === 0) return "Masukkan kata sandi admin saat ini.";
  if (!ARCHIVE_PIN_PATTERN.test(pin)) {
    return `PIN harus ${ARCHIVE_PIN_MIN_LENGTH}–${ARCHIVE_PIN_MAX_LENGTH} digit angka.`;
  }
  if (pin !== confirmPin) return "Konfirmasi PIN tidak cocok.";
  return null;
}

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

async function readErrorMessage(response: Response): Promise<string> {
  switch (response.status) {
    case 401:
      return "Kata sandi admin salah.";
    case 403:
      return "Permintaan ditolak atau hak akses tidak mencukupi.";
    case 422:
      return "Input tidak valid. Periksa kembali format PIN.";
    case 429:
      return "Terlalu banyak percobaan. Coba lagi nanti.";
    case 503:
      return "Arsip belum siap (migrasi database belum dijalankan). Coba lagi nanti.";
    default:
      return "Gagal mengubah PIN. Coba lagi.";
  }
}

export default function ArchivePinForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const passwordId = useId();
  const pinId = useId();
  const confirmId = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const invalid = validate(pin.trim(), confirmPin.trim(), currentPassword);
    if (invalid) {
      setStatus({ kind: "error", message: invalid });
      return;
    }

    setSubmitting(true);
    setStatus({ kind: "idle" });
    try {
      const response = await fetch("/api/archive/access/pin", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-vanka-request": "1" },
        body: JSON.stringify({ pin: pin.trim(), currentPassword }),
      });

      if (response.ok) {
        setCurrentPassword("");
        setPin("");
        setConfirmPin("");
        setStatus({
          kind: "success",
          message:
            "PIN arsip diperbarui. Sesi pengunjung yang sedang aktif akan diminta memasukkan PIN lagi.",
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
        <label htmlFor={passwordId} className="text-sm text-[#fdf3d8]/80">
          Kata Sandi Admin Saat Ini
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-[#fdf3d8]/50">
          Kata sandi hanya untuk mengotorisasi perubahan PIN — PIN terpisah dari kata sandi admin.
        </p>
      </div>

      <div>
        <label htmlFor={pinId} className="text-sm text-[#fdf3d8]/80">
          PIN Baru
        </label>
        <input
          id={pinId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={ARCHIVE_PIN_MAX_LENGTH}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm tracking-[0.3em] text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-[#fdf3d8]/50">
          {ARCHIVE_PIN_MIN_LENGTH}–{ARCHIVE_PIN_MAX_LENGTH} digit angka.
        </p>
      </div>

      <div>
        <label htmlFor={confirmId} className="text-sm text-[#fdf3d8]/80">
          Konfirmasi PIN Baru
        </label>
        <input
          id={confirmId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={ARCHIVE_PIN_MAX_LENGTH}
          value={confirmPin}
          onChange={(event) => setConfirmPin(event.target.value)}
          disabled={submitting}
          className="mt-1.5 w-full h-10 rounded-lg border border-white/15 bg-transparent px-3 text-sm tracking-[0.3em] text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
        />
      </div>

      <p className="rounded-lg border border-[#f6d77a]/25 bg-[#f6d77a]/5 px-3 py-2 text-xs text-[#fdf3d8]/70">
        Mengubah PIN membatalkan sesi pengunjung yang sedang aktif — mereka harus memasukkan
        PIN baru.
      </p>

      {status.kind === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {status.message}
        </p>
      )}

      {status.kind === "success" && (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
        >
          {status.message}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] px-6 text-sm font-medium text-[#050814] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Menyimpan…" : "Ubah PIN"}
      </button>
    </form>
  );
}
