// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ArchivePinGate from "@/components/archive/ArchivePinGate";
import { ARCHIVE_PIN_UI_LENGTH, ARCHIVE_VISITOR_MESSAGES } from "@/lib/archive/visitor";

import { installFetchMock } from "./fetch-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function boxes(): HTMLInputElement[] {
  return screen.getAllByLabelText(/^Digit PIN ke-\d$/) as HTMLInputElement[];
}

function typePin(value: string) {
  const inputs = boxes();
  for (let i = 0; i < value.length; i += 1) {
    fireEvent.change(inputs[i], { target: { value: value[i] } });
  }
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Buka Arsip" }) as HTMLButtonElement;
}

describe("ArchivePinGate (six-digit)", () => {
  it("renders six labelled digit boxes inside a named group", () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    expect(screen.getByRole("group", { name: "PIN" })).toBeTruthy();
    const inputs = boxes();
    expect(inputs).toHaveLength(6);
    expect(inputs.every((input) => input.type === "password")).toBe(true);
    expect((inputs[0].getAttribute("aria-label") ?? "")).toContain("Digit PIN ke-1");
  });

  it("auto-advances focus as digits are typed", () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    const inputs = boxes();
    fireEvent.change(inputs[0], { target: { value: "1" } });
    expect(document.activeElement).toBe(inputs[1]);
    fireEvent.change(inputs[1], { target: { value: "2" } });
    expect(document.activeElement).toBe(inputs[2]);
  });

  it("Backspace clears the current box, then steps back and clears the previous", () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    const inputs = boxes();
    fireEvent.change(inputs[0], { target: { value: "1" } });
    fireEvent.change(inputs[1], { target: { value: "2" } });

    // Focused on box 3 (empty) → Backspace steps back to box 2 and clears it.
    fireEvent.keyDown(inputs[2], { key: "Backspace" });
    expect(inputs[1].value).toBe("");
    expect(document.activeElement).toBe(inputs[1]);

    // Now box 2 is focused but empty → Backspace clears box 1 and steps back.
    fireEvent.keyDown(inputs[1], { key: "Backspace" });
    expect(inputs[0].value).toBe("");
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("accepts a pasted six-digit PIN and fills every box", () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    const inputs = boxes();
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => "135790" } });

    expect(inputs.map((input) => input.value).join("")).toBe("135790");
    expect(submitButton().disabled).toBe(false);
  });

  it("does not submit before all six digits are entered", () => {
    const { calls } = installFetchMock(() => ({ status: 200 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    typePin("13579");
    expect(submitButton().disabled).toBe(true);

    // Even a forced form submit is guarded.
    const form = boxes()[0].closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(screen.getByRole("alert").textContent).toBe(`Masukkan ${ARCHIVE_PIN_UI_LENGTH} digit PIN.`);
    expect(calls).toHaveLength(0);
  });

  it("submits exactly the typed six digits with CSRF-safe headers", async () => {
    const { calls } = installFetchMock(() => ({
      status: 200,
      body: { data: { unlocked: true } },
    }));
    const onUnlocked = vi.fn();
    render(<ArchivePinGate onUnlocked={onUnlocked} />);

    typePin("135790");
    fireEvent.click(submitButton());
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/archive/access");
    expect(calls[0].init?.method).toBe("POST");
    const sentHeaders = calls[0].init?.headers as Record<string, string>;
    expect(sentHeaders["content-type"]).toBe("application/json");
    expect(sentHeaders["x-vanka-request"]).toBe("1");
    // The value sent is the unmodified six digits.
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ pin: "135790" });
  });

  it("unlocks only after the server confirms success (no optimistic unlock)", async () => {
    installFetchMock(() => ({ status: 401 }));
    const onUnlocked = vi.fn();
    render(<ArchivePinGate onUnlocked={onUnlocked} />);

    typePin("135790");
    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it.each([
    [401, ARCHIVE_VISITOR_MESSAGES.invalidPin],
    [422, ARCHIVE_VISITOR_MESSAGES.invalidPin],
    [429, ARCHIVE_VISITOR_MESSAGES.rateLimited],
    [503, ARCHIVE_VISITOR_MESSAGES.unavailable],
  ])("handles status %i with an honest, generic message", async (status, message) => {
    installFetchMock(() => ({ status }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    typePin("135790");
    fireEvent.click(submitButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    // The full PIN never appears in the error output.
    expect(alert.textContent).not.toContain("135790");
  });

  it("shows a network message when the request fails", async () => {
    installFetchMock(() => {
      throw new Error("offline");
    });
    render(<ArchivePinGate onUnlocked={vi.fn()} />);
    typePin("135790");
    fireEvent.click(submitButton());

    expect((await screen.findByRole("alert")).textContent).toBe(
      ARCHIVE_VISITOR_MESSAGES.networkError,
    );
  });

  it("shows a neutral notice when provided", () => {
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} notice={ARCHIVE_VISITOR_MESSAGES.sessionEnded} />);
    expect(screen.getByRole("status").textContent).toBe(ARCHIVE_VISITOR_MESSAGES.sessionEnded);
  });

  it("never persists the PIN to storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    installFetchMock(() => ({ status: 401 }));
    render(<ArchivePinGate onUnlocked={vi.fn()} />);
    typePin("135790");
    fireEvent.click(submitButton());
    await screen.findByRole("alert");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not call the API twice while a request is in flight", async () => {
    const pending = new Promise<never>(() => {});
    const mock = vi.fn(() => pending);
    (globalThis as unknown as { fetch: unknown }).fetch = mock;
    render(<ArchivePinGate onUnlocked={vi.fn()} />);

    typePin("135790");
    const button = submitButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
