// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/admin/ui/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/components/birthday/BirthdayCountdown", () => ({
  default: ({ onOpenGift, onClose }: { onOpenGift: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Menuju ulang tahun Vanka">
      <button type="button" onClick={onOpenGift}>Buka Kado Vanka</button>
      <button type="button" onClick={onClose}>Tutup preview</button>
    </div>
  ),
}));

vi.mock("@/components/birthday/BirthdayExperiencePlayer", () => ({
  default: ({
    draftAge,
    autoStartMusic,
    autoOpenGift,
  }: {
    draftAge: number;
    autoStartMusic: boolean;
    autoOpenGift: boolean;
  }) => (
    <div
      data-testid="birthday-experience-player"
      data-draft-age={draftAge}
      data-auto-start-music={String(autoStartMusic)}
      data-auto-open-gift={String(autoOpenGift)}
    />
  ),
}));

import AdminBirthdayPage from "@/app/admin/(protected)/birthday/page";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Admin birthday editor preview", () => {
  it("continues from countdown into the selected draft experience", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }),
    );
    render(<AdminBirthdayPage />);

    fireEvent.click(screen.getByRole("button", { name: "Tambah Surat" }));
    fireEvent.click(screen.getByRole("button", { name: "Buat / Buka Surat" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Countdown + Experience" }));

    expect(screen.getByRole("dialog", { name: "Menuju ulang tahun Vanka" })).toBeTruthy();
    expect(
      screen.getByTestId("birthday-experience-player").getAttribute("data-auto-start-music"),
    ).toBe("false");
    expect(
      screen.getByTestId("birthday-experience-player").getAttribute("data-draft-age"),
    ).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Buka Kado Vanka" }));

    expect(screen.queryByRole("dialog", { name: "Menuju ulang tahun Vanka" })).toBeNull();
    expect(
      screen.getByTestId("birthday-experience-player").getAttribute("data-auto-start-music"),
    ).toBe("true");
    expect(
      screen.getByTestId("birthday-experience-player").getAttribute("data-auto-open-gift"),
    ).toBe("true");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
