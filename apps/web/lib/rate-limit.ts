/** Minimal in-memory rate limiter (spec §30): token bucket per client IP.
 *
 * Good enough for a demo/Devpost submission: no Redis, no external deps,
 * resets on process restart. Keyed on the client IP from X-Forwarded-For
 * (behind a single trusted reverse proxy) or the request IP.
 */

const BUCKETS = new Map<string, { tokens: number; lastRefill: number }>();

export interface RateLimitConfig {
  /** Max requests per windowMs per client IP. */
  limit: number;
  windowMs: number;
}

function clientIp(req: Request): string {
  // Trust order matters. `x-real-ip` is set by our own reverse proxy (nginx: proxy_set_header
  // X-Real-IP $remote_addr), which *replaces* whatever the client sent — so it survives a
  // malicious header. `x-forwarded-for` is client-suppliable and was previously read from the
  // FIRST entry: sending a fresh fake IP per request defeated every limit (measured against the
  // anchor route, whose only other gate is a JSON field). The last entry is the one appended by
  // the nearest proxy, so it is the best available fallback when x-real-ip is absent.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

export function rateLimit(req: Request, cfg: RateLimitConfig): { ok: boolean; retryAfterMs: number } {
  const key = clientIp(req);
  const now = Date.now();
  let bucket = BUCKETS.get(key);

  if (!bucket || now - bucket.lastRefill >= cfg.windowMs) {
    bucket = { tokens: cfg.limit - 1, lastRefill: now };
    BUCKETS.set(key, bucket);
    return { ok: true, retryAfterMs: 0 };
  }

  // Refill proportionally over the window (simple: full refill per window is
  // enough for a demo — but do partial refill for smoother behavior).
  const elapsed = now - bucket.lastRefill;
  const refill = (elapsed / cfg.windowMs) * cfg.limit;
  bucket.tokens = Math.min(cfg.limit, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfterMs: 0 };
  }
  return { ok: false, retryAfterMs: Math.max(1000, cfg.windowMs - elapsed) };
}

/** For tests: clear all buckets. */
export function resetRateLimits(): void {
  BUCKETS.clear();
}
