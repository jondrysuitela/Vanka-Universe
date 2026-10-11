import { describe, expect, it } from "vitest";

import {
  MAX_ADMIN_PASSWORD_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
  passwordChangeMessage,
  validatePasswordChange,
} from "@/lib/auth/password-policy";

const base = {
  currentPassword: "correct-horse-battery",
  newPassword: "brand-new-secret",
  confirmPassword: "brand-new-secret",
};

describe("validatePasswordChange", () => {
  it("accepts a well-formed change", () => {
    expect(validatePasswordChange(base)).toBeNull();
  });

  it("requires the current password", () => {
    expect(validatePasswordChange({ ...base, currentPassword: "" })).toBe("CURRENT_REQUIRED");
  });

  it("enforces the minimum and maximum new-password length", () => {
    expect(
      validatePasswordChange({ ...base, newPassword: "short", confirmPassword: "short" }),
    ).toBe("NEW_TOO_SHORT");
    const tooLong = "x".repeat(MAX_ADMIN_PASSWORD_LENGTH + 1);
    expect(
      validatePasswordChange({ ...base, newPassword: tooLong, confirmPassword: tooLong }),
    ).toBe("NEW_TOO_LONG");
  });

  it("requires matching confirmation", () => {
    expect(validatePasswordChange({ ...base, confirmPassword: "different-secret" })).toBe(
      "CONFIRM_MISMATCH",
    );
  });

  it("rejects reusing the current password", () => {
    expect(
      validatePasswordChange({
        currentPassword: "same-secret-value",
        newPassword: "same-secret-value",
        confirmPassword: "same-secret-value",
      }),
    ).toBe("SAME_AS_CURRENT");
  });

  it("accepts a value exactly at the minimum length", () => {
    const min = "y".repeat(MIN_ADMIN_PASSWORD_LENGTH);
    expect(validatePasswordChange({ ...base, newPassword: min, confirmPassword: min })).toBeNull();
  });
});

describe("passwordChangeMessage", () => {
  it("returns a distinct, non-empty message per code", () => {
    const codes = [
      "CURRENT_REQUIRED",
      "NEW_TOO_SHORT",
      "NEW_TOO_LONG",
      "CONFIRM_MISMATCH",
      "SAME_AS_CURRENT",
    ] as const;
    const messages = codes.map((code) => passwordChangeMessage(code));
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
