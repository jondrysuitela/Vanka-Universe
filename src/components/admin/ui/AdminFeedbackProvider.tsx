"use client";

import { ToastProvider } from "./ToastProvider";

export default function AdminFeedbackProvider({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
