import Link from "next/link";
import { listEvidence } from "@/lib/db";

export const dynamic = "force-dynamic";

const statusColor: Record<string, string> = {
  SUPPORTED: "text-emerald-400 border-emerald-800",
  LIKELY_TRUE: "text-emerald-300 border-emerald-900",
  UNCERTAIN: "text-amber-400 border-amber-800",
  CONTRADICTED: "text-rose-400 border-rose-800",
  INSUFFICIENT_EVIDENCE: "text-neutral-400 border-neutral-700",
};

const STATUSES = ["SUPPORTED", "LIKELY_TRUE", "CONTRADICTED", "INSUFFICIENT_EVIDENCE"] as const;

export default function EvidenceListPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string };
}) {
  const status = searchParams?.status || undefined;
  const q = searchParams?.q || undefined;
  const items = listEvidence({ status, q, limit: 100 });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Evidence Records</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {items.length} package{items.length === 1 ? "" : "s"} — SHA-256 fingerprints of
            verified web claims
          </p>
        </div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Dashboard
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search claims or id…"
          className="w-64 rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-300"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Filter
        </button>
        {(status || q) && (
          <Link href="/evidence" className="text-xs text-neutral-500 hover:text-neutral-300">
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          No evidence yet. Create one via{" "}
          <code className="text-neutral-300">POST /api/evidence</code> or run the demo
          (Phase 7).
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.id}>
              <Link
                href={`/evidence/${e.id}`}
                className="block rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 transition-colors hover:border-neutral-600"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm text-neutral-500">{e.id}</span>
                  <span
                    className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                      statusColor[e.status] ?? "text-neutral-400 border-neutral-700"
                    }`}
                  >
                    {e.status}
                  </span>
                  <span className="text-xs text-neutral-500">
                    confidence {(e.confidence * 100).toFixed(0)}%
                  </span>
                  {e.anchored && (
                    <span className="text-xs font-semibold text-amber-400">⛓ anchored</span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-neutral-200">{e.claimText}</p>
                <p className="mt-2 font-mono text-xs text-neutral-600">
                  sha256:{e.hash.slice(0, 16)}…
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
