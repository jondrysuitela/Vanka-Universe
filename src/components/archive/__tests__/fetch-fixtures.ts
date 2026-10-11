import { vi } from "vitest";

/**
 * Minimal `fetch` double for the visitor UI tests (Tahap 4A).
 *
 * Deliberately avoids the global `Response`/`fetch` implementations so the tests
 * behave identically under the jsdom environment. Only `status`, `ok`, and
 * `json()` are provided — exactly what the visitor components consume.
 */

export interface FetchCall {
  url: string;
  init?: RequestInit;
}

export type FetchHandler = (url: string, init?: RequestInit) => {
  status: number;
  body?: unknown;
};

function readUrl(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

export function installFetchMock(handler: FetchHandler): {
  mock: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const mock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = readUrl(input);
    calls.push({ url, init });
    try {
      const result = handler(url, init);
      return Promise.resolve({
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        json: async () => result.body ?? {},
      });
    } catch (error) {
      return Promise.reject(error);
    }
  });
  (globalThis as unknown as { fetch: unknown }).fetch = mock;
  return { mock, calls };
}
