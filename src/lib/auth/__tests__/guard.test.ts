import { describe, expect, it, vi, beforeEach } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import {
  ApiError,
  API_CUSTOM_HEADER,
  assertSafeMutation,
  jsonError,
  jsonOk,
  requireRole,
} from "@/lib/auth/guard";
import type { SessionAdmin } from "@/lib/auth/session";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
});

const admin = (role: SessionAdmin["role"]): SessionAdmin => ({
  id: "a1",
  email: "a@vanka.universe",
  name: "A",
  role,
});

function mutationRequest(overrides: { origin?: string | null; contentType?: string; custom?: string } = {}) {
  const headers = new Headers();
  if (overrides.origin !== null && overrides.origin !== undefined) {
    headers.set("origin", overrides.origin);
  } else if (overrides.origin === undefined) {
    headers.set("origin", "https://vanka.test");
  }
  headers.set("content-type", overrides.contentType ?? "application/json");
  headers.set(API_CUSTOM_HEADER, overrides.custom ?? "1");
  return new Request("https://vanka.test/api/auth/login", { method: "POST", headers, body: "{}" });
}

describe("requireRole", () => {
  it("allows roles in the list", () => {
    expect(() => requireRole(admin("owner"), ["owner", "admin"])).not.toThrow();
  });

  it("throws ApiError 403 for a role not in the list", () => {
    let thrown: unknown;
    try {
      requireRole(admin("editor"), ["owner", "admin"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(403);
    expect((thrown as ApiError).code).toBe("FORBIDDEN");
    expect((thrown as ApiError).toResponse().status).toBe(403);
  });
});

describe("json helpers", () => {
  it("jsonError produces the uniform error shape", async () => {
    const res = jsonError(422, "VALIDATION_ERROR", "Input tidak valid.", { fieldErrors: {} });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Input tidak valid.", details: { fieldErrors: {} } },
    });
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("jsonOk produces { data }", async () => {
    const res = jsonOk({ hello: "world" });
    expect((await res.json()).data).toEqual({ hello: "world" });
  });

  it("ApiError never leaks stack/db details in the response", async () => {
    const err = new ApiError(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.");
    const body = await err.toResponse().json();
    expect(JSON.stringify(body)).not.toContain("at ");
    expect(JSON.stringify(body)).not.toContain("node:");
  });
});

describe("assertSafeMutation", () => {
  it("passes for a same-origin JSON request with custom header", () => {
    expect(() => assertSafeMutation(mutationRequest())).not.toThrow();
  });

  it("rejects a missing Origin", () => {
    const request = mutationRequest({ origin: null });
    expect(() => assertSafeMutation(request)).toThrowError(/Origin/);
  });

  it("rejects a mismatched Origin", () => {
    const request = mutationRequest({ origin: "https://evil.example" });
    expect(() => assertSafeMutation(request)).toThrowError(/Origin/);
  });

  it("rejects a non-JSON content type", () => {
    const request = mutationRequest({ contentType: "text/plain" });
    expect(() => assertSafeMutation(request)).toThrowError(/Content-Type/);
  });

  it("rejects a missing custom header", () => {
    const request = mutationRequest({ custom: "" });
    expect(() => assertSafeMutation(request)).toThrowError(/Header|wajib/i);
  });

  it("skips checks for GET", () => {
    const request = new Request("https://vanka.test/api/auth/me");
    expect(() => assertSafeMutation(request)).not.toThrow();
  });
});