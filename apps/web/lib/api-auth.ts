/**
 * Shared-secret gate for the dashboard API.
 *
 * Measured exposure before this existed: every route under /api was anonymous and only nine of
 * twenty-one had a rate limiter. Anyone who found the public URL could write evidence records,
 * trigger Greenfield publishes, mutate claim state, and — via /api/anchor/[id], whose only gate
 * was a JSON `confirm: true` — spend the server wallet's gas on permanent public transactions.
 *
 * Rules:
 *   · DASHBOARD_API_KEY unset → no gate. That is only appropriate for a 127.0.0.1 dev instance;
 *     a public deployment must set it (the MCP server presents the same value when it calls
 *     /api/evidence, so the two services agree on one secret).
 *   · /api/health stays open in either case: monitoring must not need credentials.
 */

export const API_KEY_HEADER = "x-api-key";

export function configuredKey(): string {
  return (process.env.DASHBOARD_API_KEY ?? "").trim();
}

/** The caller's key, from X-API-Key or a Bearer token. */
export function presentedKey(req: Request): string {
  const direct = req.headers.get(API_KEY_HEADER);
  if (direct) return direct.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

/** Constant-time-ish comparison; the length check avoids leaking via early exit. */
export function keyMatches(presented: string, expected: string): boolean {
  if (!expected) return true; // no gate configured
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** True when the request may proceed. */
export function apiAuthorized(req: Request): boolean {
  return keyMatches(presentedKey(req), configuredKey());
}

/** Standard 401 body, matching the shape every other route returns. */
export function unauthorizedResponse() {
  return Response.json(
    { success: false, error: { type: "UNAUTHORIZED", message: "Missing or wrong X-API-Key." } },
    { status: 401 },
  );
}
