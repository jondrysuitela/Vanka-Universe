"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface LoginErrorBody {
  error?: { code?: string; message?: string };
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = email.trim().length === 0 || password.trim().length === 0;
  const invalid = touched && empty;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (submitting || empty) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vanka-request": "1",
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as LoginErrorBody | null;
        // Generic, non-enumerating message; never reveal whether the account exists.
        setError(body?.error?.message ?? "Email atau kata sandi salah.");
        setSubmitting(false);
        return;
      }

      // Session cookie is now set by the server. Go to the dashboard.
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server. Coba lagi.");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#050814] text-[#f8fafc]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1226]/80 backdrop-blur-xl p-8">
        <div className="text-center">
          <h1 className="text-2xl font-display tracking-widest text-[#fdf3d8]">Masuk Admin</h1>
          <p className="text-sm text-[#fdf3d8]/70 mt-2">Panel Admin · Vanka Universe</p>
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit} aria-busy={submitting}>
          <div>
            <label htmlFor="email" className="text-sm text-[#fdf3d8]/80">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={submitting}
              className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-3 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
              placeholder="admin@vanka.universe"
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-sm text-[#fdf3d8]/80">
              Kata Sandi
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={submitting}
              className="mt-2 w-full rounded-lg bg-transparent border border-white/15 px-3 py-2.5 text-sm text-[#f8fafc] focus:outline-none focus:ring-1 focus:ring-[#f6d77a]/40 disabled:opacity-60"
              placeholder="••••••••"
              autoComplete="current-password"
            />
            {invalid && <p className="text-xs text-red-300 mt-2">Mohon isi email dan kata sandi.</p>}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] py-2.5 text-sm font-medium hover:opacity-95 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Memasuki…" : "Masuk"}
            </button>
            <Link
              href="/"
              className="block text-center w-full rounded-lg border border-white/15 text-[#fdf3d8]/90 py-2.5 text-sm hover:bg-white/5 transition-colors"
            >
              Kembali ke Beranda
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
