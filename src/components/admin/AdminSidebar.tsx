"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/media", label: "Pustaka Media" },
  { href: "/admin/memories", label: "Arsip Kenangan" },
  { href: "/admin/birthday", label: "Tulis Surat" },
  { href: "/admin/themes", label: "Katalog Tema Tahunan" },
  { href: "/admin/content", label: "Editor Konten" },
  { href: "/admin/archive", label: "Arsip Privat" },
  { href: "/admin/settings", label: "Pengaturan" },
];

export default function AdminSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="md:hidden px-4 pt-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full rounded-xl border border-white/10 bg-[#0b1226]/80 backdrop-blur-xl px-4 py-2 text-sm text-[#fdf3d8]/90 hover:text-[#fdf3d8] hover:bg-white/5"
          aria-label="Buka/tutup navigasi admin"
        >
          {open ? "Tutup Navigasi" : "Buka Navigasi"}
        </button>
      </div>
      <aside
        className={`${
          open ? "flex" : "hidden"
        } md:flex md:w-72 flex-col border-r border-white/10 bg-[#050814]/95 backdrop-blur-xl md:h-screen md:sticky md:top-0`}
      >
        <div className="px-6 py-5 border-b border-white/10">
          <Link href="/" className="text-lg font-display tracking-widest text-[#fdf3d8]">
            Vanka Universe
          </Link>
          <p className="text-xs mt-1 text-[#fdf3d8]/60">Panel Admin</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
          {NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                  active
                    ? "bg-white/10 text-[#fdf3d8]"
                    : "text-[#fdf3d8]/80 hover:bg-white/5 hover:text-[#fdf3d8]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-white/10 mt-auto">
          <Link
            href="/admin/login"
            onClick={() => setOpen(false)}
            className="text-sm text-[#fdf3d8]/70 hover:text-[#fdf3d8]"
          >
            Keluar
          </Link>
        </div>
      </aside>
    </>
  );
}
