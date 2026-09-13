import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { apiAuthorized, configuredKey, keyMatches, presentedKey } from "../lib/api-auth";
import { rateLimit, resetRateLimits } from "../lib/rate-limit";

/**
 * The measured gaps these pin down:
 *  · every /api route was anonymous (auth lived nowhere);
 *  · the anchor route's only gate was a JSON field, so any caller could spend the signer
 *    wallet's gas (it must fail CLOSED when no secret is configured);
 *  · the limiter keyed on the FIRST X-Forwarded-For entry, which the caller controls — a fresh
 *    fake IP per request defeated every limit on the one route that costs money.
 */

function req(headers: Record<string, string>): Request {
  return new Request("https://host/webmcp/api/anchor/EV-1", { method: "POST", headers });
}

describe("dashboard API key gate", () => {
  const ORIGINAL = process.env.DASHBOARD_API_KEY;

  beforeEach(() => {
    delete process.env.DASHBOARD_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = ORIGINAL;
  });

  it("reads the key from X-API-Key or a Bearer token", () => {
    expect(presentedKey(req({ "x-api-key": "abc" }))).toBe("abc");
    expect(presentedKey(req({ authorization: "Bearer abc" }))).toBe("abc");
    expect(presentedKey(req({ authorization: "bearer abc" }))).toBe("abc");
    expect(presentedKey(req({}))).toBe("");
  });

  it("is a no-op when no secret is configured (local dev)", () => {
    expect(configuredKey()).toBe("");
    expect(apiAuthorized(req({}))).toBe(true);
  });

  it("requires the exact secret once configured", () => {
    process.env.DASHBOARD_API_KEY = "s3cret";
    expect(apiAuthorized(req({}))).toBe(false);
    expect(apiAuthorized(req({ "x-api-key": "wrong" }))).toBe(false);
    expect(apiAuthorized(req({ "x-api-key": "s3cre" }))).toBe(false);
    expect(apiAuthorized(req({ "x-api-key": "s3cret" }))).toBe(true);
    expect(apiAuthorized(req({ authorization: "Bearer s3cret" }))).toBe(true);
  });

  it("compares without an early exit on the first differing character", () => {
    expect(keyMatches("", "s3cret")).toBe(false);
    expect(keyMatches("X3cret", "s3cret")).toBe(false);
    expect(keyMatches("s3cret", "s3cret")).toBe(true);
    expect(keyMatches("anything", "")).toBe(true); // no gate configured
  });
});

describe("rate limiter keying", () => {
  beforeEach(() => resetRateLimits());

  it("prefers the proxy-set x-real-ip over a client-supplied X-Forwarded-For", () => {
    const cfg = { limit: 2, windowMs: 60_000 };
    // Two calls from the same real client, each forging a different XFF — the previous
    // implementation keyed on XFF[0] and would have allowed both forever.
    const first = rateLimit(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), cfg);
    const second = rateLimit(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "8.8.8.8" }), cfg);
    const third = rateLimit(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "7.7.7.7" }), cfg);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third.ok).toBe(false); // the forged header no longer buys a new bucket
  });

  it("falls back to the last X-Forwarded-For entry (nearest proxy), never the first", () => {
    const cfg = { limit: 1, windowMs: 60_000 };
    const a = rateLimit(req({ "x-forwarded-for": "9.9.9.9, 5.5.5.5" }), cfg);
    const b = rateLimit(req({ "x-forwarded-for": "8.8.8.8, 5.5.5.5" }), cfg);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false); // same nearest-proxy hop → same bucket
  });

  it("groups header-less callers instead of giving each a free bucket", () => {
    const cfg = { limit: 1, windowMs: 60_000 };
    expect(rateLimit(req({}), cfg).ok).toBe(true);
    expect(rateLimit(req({}), cfg).ok).toBe(false);
  });
});
