import { describe, expect, it } from "vitest";

import {
  TRUSTED_IP_HEADER_ENV,
  resolveClientIp,
  trustedIpHeader,
} from "@/lib/archive/access/request";

function req(headers: Record<string, string>): Request {
  return new Request("https://vanka.test/", { headers });
}

describe("trustedIpHeader", () => {
  it("is null when unconfigured or blank", () => {
    expect(trustedIpHeader({})).toBeNull();
    expect(trustedIpHeader({ [TRUSTED_IP_HEADER_ENV]: "" })).toBeNull();
    expect(trustedIpHeader({ [TRUSTED_IP_HEADER_ENV]: "   " })).toBeNull();
  });

  it("lowercases the configured header name", () => {
    expect(trustedIpHeader({ [TRUSTED_IP_HEADER_ENV]: "CF-Connecting-IP" })).toBe(
      "cf-connecting-ip",
    );
  });
});

describe("resolveClientIp", () => {
  it("returns null by default and IGNORES x-forwarded-for", () => {
    expect(resolveClientIp(req({ "x-forwarded-for": "1.2.3.4" }), {})).toBeNull();
    expect(resolveClientIp(req({ "x-real-ip": "1.2.3.4" }), {})).toBeNull();
  });

  it("reads ONLY the configured trusted header", () => {
    const env = { [TRUSTED_IP_HEADER_ENV]: "cf-connecting-ip" };
    expect(
      resolveClientIp(
        req({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.2.3.4" }),
        env,
      ),
    ).toBe("9.9.9.9");
    // A spoofed untrusted header yields no identity.
    expect(resolveClientIp(req({ "x-forwarded-for": "1.2.3.4" }), env)).toBeNull();
  });

  it("takes the first hop, trims, and yields null for a blank value", () => {
    const env = { [TRUSTED_IP_HEADER_ENV]: "x-forwarded-for" };
    expect(resolveClientIp(req({ "x-forwarded-for": " 1.1.1.1 , 2.2.2.2" }), env)).toBe(
      "1.1.1.1",
    );
    expect(resolveClientIp(req({ "x-forwarded-for": "   " }), env)).toBeNull();
    expect(resolveClientIp(req({}), env)).toBeNull();
  });
});
