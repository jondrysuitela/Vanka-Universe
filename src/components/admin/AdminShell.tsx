"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import AdminSidebar from "./AdminSidebar";

/**
 * Routes under `/admin` that must render WITHOUT the dashboard chrome
 * (sidebar / navigation). Currently only the login page — it is reached before
 * a session exists, so it must not expose dashboard navigation.
 */
const BARE_ROUTES = new Set<string>(["/admin/login"]);

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname && BARE_ROUTES.has(pathname)) {
    return <div className="min-h-screen bg-[#050814] text-[#f8fafc]">{children}</div>;
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(243,232,255,0.08),transparent),radial-gradient(1400px_700px_at_80%_10%,rgba(253,243,216,0.06),transparent)] bg-[#050814] text-[#f8fafc]">
      <AdminSidebar />
      <main className="flex-1 overflow-x-hidden">
        <div className="px-4 sm:px-6 lg:px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
