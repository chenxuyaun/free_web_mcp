import { NextResponse, type NextRequest } from "next/server";

/**
 * Gate every API route behind the shared secret when DASHBOARD_API_KEY is configured.
 *
 * A middleware rather than twenty-one per-route checks: the measured gap was exactly that
 * coverage was uneven (nine of twenty-one routes had a rate limiter, none had auth), and a new
 * route added later would silently inherit the hole. One gate covers whatever exists and
 * whatever comes next.
 *
 * Exemptions: /api/health (monitoring) and the dashboard's own HTML pages (they only read; the
 * data they display is fetched through the gated API from the browser — set the key in the
 * browser session or keep the instance private).
 */

const OPEN_PATHS = ["/api/health"];

/**
 * Reads stay open, writes need the key.
 *
 * The edge (nginx) already draws the line this way, and the two layers must agree: gating GETs
 * too would break the owner's own dashboard, whose pages fetch their data through this API from a
 * browser that has no way to send the header. The writes — evidence creation, claim state
 * transitions, and above all the gas-spending anchor route — are what must be protected.
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function withBasePath(pathname: string): boolean {
  // next.config.mjs sets basePath=/webmcp; middleware sees the full incoming path.
  return pathname.includes("/api/");
}

export function middleware(req: NextRequest) {
  const key = (process.env.DASHBOARD_API_KEY ?? "").trim();
  if (!key) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (!withBasePath(pathname)) return NextResponse.next();
  if (READ_METHODS.has(req.method)) return NextResponse.next();
  const normalized = pathname.replace(/^\/webmcp/, "");
  if (OPEN_PATHS.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const direct = req.headers.get("x-api-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const presented = direct.trim() || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "");
  if (presented.length === key.length) {
    let diff = 0;
    for (let i = 0; i < key.length; i++) diff |= presented.charCodeAt(i) ^ key.charCodeAt(i);
    if (diff === 0) return NextResponse.next();
  }

  return NextResponse.json(
    { success: false, error: { type: "UNAUTHORIZED", message: "Missing or wrong X-API-Key." } },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/api/:path*", "/webmcp/api/:path*"],
};
