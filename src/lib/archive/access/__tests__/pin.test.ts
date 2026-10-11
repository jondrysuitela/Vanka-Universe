import { describe, expect, it } from "vitest";

import { hashPin, isValidPinFormat, verifyPin } from "@/lib/archive/access/pin";

describe("isValidPinFormat", () => {
  it("accepts digit strings within the allowed bounds", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("123456789012")).toBe(true);
  });

  it("rejects strings that are too short or too long", () => {
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("1234567890123")).toBe(false);
  });

  it("rejects non-digit content and non-strings", () => {
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("12 34")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
    expect(isValidPinFormat("  1234")).toBe(false);
    expect(isValidPinFormat(1234 as unknown as string)).toBe(false);
    expect(isValidPinFormat(null)).toBe(false);
    expect(isValidPinFormat(undefined)).toBe(false);
  });
});

describe("hashPin", () => {
  it("hashes a valid PIN without embedding the plaintext", async () => {
    const hash = await hashPin("4821");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
    expect(hash).not.toContain("4821");
  });

  it("refuses a malformed PIN instead of storing junk", async () => {
    await expect(hashPin("abc")).rejects.toThrow(/format/);
    await expect(hashPin("12")).rejects.toThrow(/format/);
  });
});

describe("verifyPin", () => {
  it("verifies the correct PIN", async () => {
    const hash = await hashPin("90125");
    await expect(verifyPin("90125", hash)).resolves.toBe(true);
  });

  it("rejects a wrong PIN", async () => {
    const hash = await hashPin("90125");
    await expect(verifyPin("11111", hash)).resolves.toBe(false);
  });

  it("rejects a malformed PIN (fail-closed) without a stored hash", async () => {
    await expect(verifyPin("abc", null)).resolves.toBe(false);
    await expect(verifyPin("", null)).resolves.toBe(false);
  });

  it("treats a missing/empty stored hash as 'no credential', never as an empty PIN", async () => {
    await expect(verifyPin("1234", null)).resolves.toBe(false);
    await expect(verifyPin("1234", undefined)).resolves.toBe(false);
    await expect(verifyPin("1234", "")).resolves.toBe(false);
  });
});
