import type { Metadata } from "next";
import AdminShell from "@/components/admin/AdminShell";
import AdminFeedbackProvider from "@/components/admin/ui/AdminFeedbackProvider";

export const metadata: Metadata = {
  title: "Panel Admin · Vanka Universe",
  description: "Panel admin Vanka Universe",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminFeedbackProvider>
      <AdminShell>{children}</AdminShell>
    </AdminFeedbackProvider>
  );
}
