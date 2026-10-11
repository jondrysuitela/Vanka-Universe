// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import AdminSettingsPage from "@/app/admin/(protected)/settings/page";
import { ToastProvider } from "@/components/admin/ui/ToastProvider";

import { installFetchMock } from "@/components/archive/__tests__/fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <ToastProvider>
      <AdminSettingsPage />
    </ToastProvider>,
  );
}

function meRoute(role: string | null, status = 200) {
  return (url: string) => {
    if (url === "/api/auth/me") {
      return status === 200
        ? { status, body: { data: { admin: { id: "a", email: "e", name: "n", role } } } }
        : { status };
    }
    return { status: 404 };
  };
}

describe("admin settings page — security sections", () => {
  it("always shows the password change form", () => {
    installFetchMock(meRoute("owner"));
    renderPage();
    expect(screen.getByRole("heading", { name: "Keamanan Akun" })).toBeTruthy();
    expect(screen.getByLabelText("Kata Sandi Saat Ini")).toBeTruthy();
  });

  it("shows the archive PIN form to an owner", async () => {
    installFetchMock(meRoute("owner"));
    renderPage();
    expect(await screen.findByLabelText("PIN Baru")).toBeTruthy();
    expect(screen.getByLabelText("Kata Sandi Admin Saat Ini")).toBeTruthy();
  });

  it("hides the archive PIN form from an editor", async () => {
    installFetchMock(meRoute("editor"));
    renderPage();
    expect(await screen.findByText(/Hanya peran owner atau admin/)).toBeTruthy();
    expect(screen.queryByLabelText("PIN Baru")).toBeNull();
    // The password form stays available to every authenticated admin.
    expect(screen.getByLabelText("Kata Sandi Saat Ini")).toBeTruthy();
  });

  it("does not offer the PIN form when the role cannot be determined", async () => {
    installFetchMock(meRoute(null, 401));
    renderPage();
    expect(await screen.findByText(/Hanya peran owner atau admin/)).toBeTruthy();
    expect(screen.queryByLabelText("PIN Baru")).toBeNull();
  });
});
