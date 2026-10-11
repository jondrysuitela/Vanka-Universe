// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import ArchivePinForm from "@/components/admin/security/ArchivePinForm";

import { installFetchMock } from "@/components/archive/__tests__/fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fill(password: string, pin: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Kata Sandi Admin Saat Ini"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("PIN Baru"), { target: { value: pin } });
  fireEvent.change(screen.getByLabelText("Konfirmasi PIN Baru"), { target: { value: confirm } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Ubah PIN" }));
}

describe("ArchivePinForm", () => {
  it("rejects a malformed PIN client-side without calling the API", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<ArchivePinForm />);
    fill("admin-password", "12", "12");
    submit();

    expect(screen.getByRole("alert").textContent).toContain("digit angka");
    expect(calls).toHaveLength(0);
  });

  it("rejects a PIN confirmation mismatch client-side", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<ArchivePinForm />);
    fill("admin-password", "1234", "5678");
    submit();

    expect(screen.getByRole("alert").textContent).toContain("tidak cocok");
    expect(calls).toHaveLength(0);
  });

  it("requires the admin password before submitting", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<ArchivePinForm />);
    fill("", "4821", "4821");
    submit();

    expect(screen.getByRole("alert").textContent).toContain("kata sandi");
    expect(calls).toHaveLength(0);
  });

  it("sends a CSRF-safe PUT with the PIN and admin password, and explains session impact", async () => {
    const { calls } = installFetchMock(() => ({ status: 200, body: { data: { accessVersion: 2 } } }));
    render(<ArchivePinForm />);
    fill("admin-password", "4821", "4821");
    submit();

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Sesi pengunjung");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/archive/access/pin");
    expect(calls[0].init?.method).toBe("PUT");
    const sentHeaders = calls[0].init?.headers as Record<string, string>;
    expect(sentHeaders["x-vanka-request"]).toBe("1");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      pin: "4821",
      currentPassword: "admin-password",
    });

    // Never leaks the internal access version.
    expect(status.textContent).not.toContain("accessVersion");
    expect((screen.getByLabelText("PIN Baru") as HTMLInputElement).value).toBe("");
  });

  it("shows a generic message when the admin password is wrong (401)", async () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinForm />);
    fill("wrong-password", "4821", "4821");
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("Kata sandi admin salah.");
  });

  it.each([
    [429, "Terlalu banyak"],
    [503, "belum siap"],
  ])("distinguishes status %i without leaking detail", async (statusCode, fragment) => {
    installFetchMock(() => ({ status: statusCode }));
    render(<ArchivePinForm />);
    fill("admin-password", "4821", "4821");
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain(fragment);
  });

  it("reports a forbidden role (403) distinctly", async () => {
    installFetchMock(() => ({ status: 403 }));
    render(<ArchivePinForm />);
    fill("admin-password", "4821", "4821");
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain("hak akses");
  });

  it("never persists the PIN or password to storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinForm />);
    fill("admin-password", "4821", "4821");
    submit();
    await screen.findByRole("alert");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("uses a capped, compact layout (no oversized inputs or full-width button)", () => {
    installFetchMock(() => ({ status: 401 }));
    const { container } = render(<ArchivePinForm />);

    const form = container.querySelector("form");
    expect(form?.className).toContain("max-w-md");
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    for (const input of inputs) {
      expect(input.className).toContain("h-10");
      expect(input.className).toContain("px-3");
    }
    const button = screen.getByRole("button", { name: "Ubah PIN" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).not.toContain("w-full");
  });
});
