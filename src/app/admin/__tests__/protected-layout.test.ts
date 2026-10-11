import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePool } from "@/lib/auth/__tests__/fake-db";

// Hoisted so the `vi.mock` factories (which run before the imports below) can
// reach these values.
const h = vi.hoisted(() => ({
  redirects: [] as string[],
  cookie: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "vanka_session" && h.cookie !== undefined ? { value: h.cookie } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    h.redirects.push(path);
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw error;
  },
}));

// The guarded layout marks itself as a request-time (blocking) segment via
// `await connection()`. Outside a real Next request render (this unit test),
// that call is a no-op.
vi.mock("next/server", () => ({
  connection: async () => undefined,
}));

vi.mock("@/lib/db", () => ({
  getPool: () => (globalThis as { __testPool?: unknown }).__testPool,
}));

import ProtectedAdminLayout, { ADMIN_LOGIN_PATH } from "@/app/admin/(protected)/layout";

let fake: ReturnType<typeof createFakePool>;

beforeEach(() => {
  fake = createFakePool();
  (globalThis as { __testPool?: unknown }).__testPool = fake.pool;
  h.redirects.length = 0;
  h.cookie = undefined;
});

const sessionRow = {
  id: "admin-1",
  email: "owner@vanka.universe",
  name: "Vanka",
  role: "owner",
  is_active: true,
  session_id: "sess-1",
};

const SECRET = createElement("p", null, "SECRET ADMIN CONTENT");

async function renderGuard() {
  return ProtectedAdminLayout({ children: SECRET });
}

describe("protected /admin/* layout guard", () => {
  it("redirects to the login page and renders NO protected content without a cookie", async () => {
    await expect(renderGuard()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual([ADMIN_LOGIN_PATH]);
    // No session lookup should even be attempted without a cookie.
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("renders the protected content for a valid active session", async () => {
    h.cookie = "valid-token";
    fake.when("WITH renewed AS", () => ({ rows: [sessionRow], rowCount: 1 }));

    const element = await renderGuard();
    expect(renderToStaticMarkup(element)).toContain("SECRET ADMIN CONTENT");
    expect(h.redirects).toEqual([]);
  });

  it("redirects when the session is unknown/expired/revoked/inactive (no row)", async () => {
    h.cookie = "stale-token";
    fake.when("WITH renewed AS", () => ({ rows: [], rowCount: 0 }));

    await expect(renderGuard()).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirects).toEqual([ADMIN_LOGIN_PATH]);
  });

  it("fails closed on a database error: redirect to login, never authenticated", async () => {
    h.cookie = "valid-token";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.when("WITH renewed AS", async () => {
      throw new Error('relation "sessions" does not exist');
    });

    try {
      await expect(renderGuard()).rejects.toThrow("NEXT_REDIRECT");
      expect(h.redirects).toEqual([ADMIN_LOGIN_PATH]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("route structure (no redirect loop)", () => {
  const root = process.cwd();

  it("serves the login page OUTSIDE the guarded route group", () => {
    const loginPage = readFileSync(join(root, "src/app/admin/login/page.tsx"), "utf8");
    // The login page must not itself be guarded, or the redirect would loop.
    expect(loginPage).not.toContain("getSessionAdmin");
    expect(loginPage).not.toContain("admin-guard");
    expect(ADMIN_LOGIN_PATH).toBe("/admin/login");
  });

  it("keeps the dashboard page INSIDE the guarded group", () => {
    const guarded = readFileSync(join(root, "src/app/admin/(protected)/page.tsx"), "utf8");
    expect(guarded.length).toBeGreaterThan(0);
  });
});
