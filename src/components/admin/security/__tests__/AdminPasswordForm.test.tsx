// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import AdminPasswordForm from "@/components/admin/security/AdminPasswordForm";

import { installFetchMock } from "@/components/archive/__tests__/fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Kata Sandi Saat Ini"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Kata Sandi Baru"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Konfirmasi Kata Sandi Baru"), {
    target: { value: confirm },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Ubah Kata Sandi" }));
}

const VALID = ["correct-horse-battery", "brand-new-secret", "brand-new-secret"] as const;

describe("AdminPasswordForm", () => {
  it("shows a client validation error and does NOT call the API on mismatch", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<AdminPasswordForm />);
    fill(VALID[0], VALID[1], "different-secret");
    submit();

    expect(screen.getByRole("alert").textContent).toContain("tidak cocok");
    expect(calls).toHaveLength(0);
  });

  it("rejects a too-short new password client-side", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<AdminPasswordForm />);
    fill(VALID[0], "short", "short");
    submit();

    expect(screen.getByRole("alert").textContent).toContain("minimal");
    expect(calls).toHaveLength(0);
  });

  it("sends a CSRF-safe PUT and only reports success after the server confirms", async () => {
    const { calls } = installFetchMock(() => ({
      status: 200,
      body: { data: { passwordChanged: true, sessionsRevoked: 1, requiresReauth: true } },
    }));
    render(<AdminPasswordForm />);
    fill(...VALID);
    submit();

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Kata sandi diperbarui");
    expect(screen.getByRole("link", { name: "Ke halaman masuk" }).getAttribute("href")).toBe(
      "/admin/login",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/auth/password");
    expect(calls[0].init?.method).toBe("PUT");
    const sentHeaders = calls[0].init?.headers as Record<string, string>;
    expect(sentHeaders["x-vanka-request"]).toBe("1");
    expect(sentHeaders["content-type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      currentPassword: VALID[0],
      newPassword: VALID[1],
      confirmPassword: VALID[2],
    });

    // Fields are cleared after success.
    expect((screen.getByLabelText("Kata Sandi Saat Ini") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Kata Sandi Baru") as HTMLInputElement).value).toBe("");
  });

  it("shows a generic message when the current password is wrong (401)", async () => {
    installFetchMock(() => ({ status: 401, body: { error: { code: "INVALID_CREDENTIALS" } } }));
    render(<AdminPasswordForm />);
    fill(...VALID);
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("Kata sandi saat ini salah.");
  });

  it("shows a service message on 503", async () => {
    installFetchMock(() => ({ status: 503 }));
    render(<AdminPasswordForm />);
    fill(...VALID);
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("belum siap");
  });

  it("does not call the API twice while a request is in flight", async () => {
    const pending = new Promise<never>(() => {});
    const mock = vi.fn(() => pending);
    (globalThis as unknown as { fetch: unknown }).fetch = mock;
    render(<AdminPasswordForm />);
    fill(...VALID);
    const submitButton = screen.getByRole("button", { name: "Ubah Kata Sandi" });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("never persists passwords to storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    installFetchMock(() => ({ status: 401 }));
    render(<AdminPasswordForm />);
    fill(...VALID);
    submit();
    await screen.findByRole("alert");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("uses a capped, compact layout (no oversized inputs or full-width button)", () => {
    installFetchMock(() => ({ status: 401 }));
    const { container } = render(<AdminPasswordForm />);

    const form = container.querySelector("form");
    expect(form?.className).toContain("max-w-md");
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    for (const input of inputs) {
      expect(input.className).toContain("h-10");
      expect(input.className).toContain("px-3");
    }
    const button = screen.getByRole("button", { name: "Ubah Kata Sandi" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).not.toContain("w-full");
  });
});
