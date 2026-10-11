import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("hashes a password and verifies it successfully", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(typeof hash).toBe("string");
    expect(hash).not.toContain("s3cret-password");
    await expect(verifyPassword("s3cret-password", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("returns false for NULL/empty stored hash instead of throwing", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
    await expect(verifyPassword("anything", undefined)).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("returns false for empty input", async () => {
    await expect(verifyPassword("", "not-a-hash")).resolves.toBe(false);
  });
});