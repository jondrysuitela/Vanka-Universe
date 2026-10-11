"use client";

import { useEffect, useState } from "react";

import AdminPasswordForm from "@/components/admin/security/AdminPasswordForm";
import ArchivePinForm from "@/components/admin/security/ArchivePinForm";
import ConfirmDialog from "@/components/admin/ui/ConfirmDialog";
import { useToast } from "@/components/admin/ui/ToastProvider";
import { PRIVATE_ARCHIVE_ROLES } from "@/lib/archive/policy";

type Role = "owner" | "admin" | "editor";

const PIN_ROLES: readonly Role[] = PRIVATE_ARCHIVE_ROLES as readonly Role[];

export default function AdminSettingsPage() {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [openApply, setOpenApply] = useState(false);
  const [role, setRole] = useState<Role | null | "unknown">("unknown");
  const { showToast } = useToast();

  // The archive PIN is owner/admin-only; fetch the caller's role so the form is
  // only offered to roles the API will accept (the API still enforces this).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/me", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as
          | { data?: { admin?: { role?: Role } } }
          | null;
        if (!active) return;
        setRole(response.ok && body?.data?.admin?.role ? body.data.admin.role : null);
      } catch {
        if (active) setRole(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const canManagePin = role !== "unknown" && role !== null && PIN_ROLES.includes(role);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display tracking-widest text-[#fdf3d8]">Pengaturan</h1>
        <p className="text-sm text-[#fdf3d8]/70 mt-2">
          Keamanan akun berlaku nyata. Preferensi tampilan di bawah masih demo lokal.
        </p>
      </div>

      {/* --------------------------------------------------- security: password */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-display text-[#fdf3d8]">Keamanan Akun</h2>
          <p className="text-xs text-[#fdf3d8]/60 mt-1">
            Ubah kata sandi admin Anda. Semua sesi akan diakhiri setelah perubahan.
          </p>
        </div>
        <AdminPasswordForm />
      </section>

      {/* ------------------------------------------------------ security: PIN */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-display text-[#fdf3d8]">PIN Arsip Privat</h2>
          <p className="text-xs text-[#fdf3d8]/60 mt-1">
            PIN pengunjung untuk Arsip Privat. Terpisah dari kata sandi admin.
          </p>
        </div>

        {role === "unknown" ? (
          <p role="status" className="text-sm text-[#fdf3d8]/60">
            Memeriksa izin…
          </p>
        ) : canManagePin ? (
          <ArchivePinForm />
        ) : (
          <p className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#fdf3d8]/70">
            Hanya peran owner atau admin yang dapat mengubah PIN Arsip Privat.
          </p>
        )}
      </section>

      {/* --------------------------------------------------- display (demo) */}
      <section className="rounded-2xl border border-white/10 bg-[#0b1226]/70 backdrop-blur-xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-display text-[#fdf3d8] mb-4">Preferensi Tampilan (Demo Lokal)</h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-sm text-[#fdf3d8]">Kurangi Animasi</p>
                <p className="text-xs text-[#fdf3d8]/60 mt-1">Menerapkan preferensi reduce motion pada panel admin (demo)</p>
              </div>
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(e) => setReduceMotion(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent"
              />
            </label>
            <label className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <p className="text-sm text-[#fdf3d8]">Mode Kompak</p>
                <p className="text-xs text-[#fdf3d8]/60 mt-1">Menyesuaikan jarak antar elemen (demo)</p>
              </div>
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(e) => setCompactMode(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent"
              />
            </label>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-display text-[#fdf3d8] mb-4">Informasi Status</h2>
          <div className="space-y-3 text-sm text-[#fdf3d8]/80">
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-[#fdf3d8]/70">Jenis Implementasi</span>
              <span>Keamanan nyata · tampilan demo</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-[#fdf3d8]/70">Autentikasi</span>
              <span>Sesi admin berbasis cookie</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-[#fdf3d8]/70">Preferensi Tampilan</span>
              <span>Demo (tidak permanen)</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-[#fdf3d8]/70">Bahasa Antarmuka</span>
              <span>Bahasa Indonesia</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpenApply(true)}
          className="rounded-lg bg-gradient-to-r from-[#f6d77a] to-[#fdf3d8] text-[#050814] px-6 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
        >
          Terapkan Pengaturan
        </button>
      </section>

      <ConfirmDialog
        open={openApply}
        title="Terapkan Preferensi Tampilan (Demo)"
        description="Preferensi tampilan ini hanya berlaku untuk sesi demo lokal ini. Tidak disimpan permanen."
        confirmLabel="Oke"
        cancelLabel="Tutup"
        onConfirm={() => {
          setOpenApply(false);
          showToast({ title: "Demo", message: "Preferensi tampilan diterapkan untuk sesi ini (demo lokal).", type: "info" });
        }}
        onCancel={() => setOpenApply(false)}
      />
    </div>
  );
}
