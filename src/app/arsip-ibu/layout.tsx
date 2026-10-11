import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Arsip Ibu · Vanka Universe",
  description: "Arsip privat keluarga — dibuka dengan PIN.",
  robots: { index: false, follow: false },
};

export default function ArsipIbuLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
