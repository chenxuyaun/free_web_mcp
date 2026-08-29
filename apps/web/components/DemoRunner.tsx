"use client";

import { Check, Loader2, Play, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BASE_PATH } from "@/lib/paths";

interface DemoStep {
  step: string;
  ok: boolean;
  detail?: string;
}

interface DemoResult {
  success?: boolean;
  evidenceId?: string;
  hash?: string;
  status?: string;
  confidence?: number;
  steps?: DemoStep[];
  error?: { message?: string };
}

const STEP_ORDER = ["Search", "Fetch", "Extract", "Verify", "Hash"];

export function DemoRunner() {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<DemoStep[]>([]);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Run Demo</h3>
          <p className="text-xs text-neutral-500">
            Demo claim → search → fetch → extract → verify → hash (spec §22). The
            blockchain anchor is offered separately.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            setError(null);
            setResult(null);
            setSteps([]);
            try {
              const res = await fetch(`${BASE_PATH}/api/demo/run`, { method: "POST" });
              const data = (await res.json()) as DemoResult;
              setSteps(data.steps ?? []);
              if (!res.ok || data.success === false) {
                setError(data.error?.message ?? `HTTP ${res.status}`);
              } else {
                setResult(data);
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? "Running…" : "Run Demo"}
        </button>
      </div>

      {steps.length > 0 && (
        <ul className="mt-4 space-y-1">
          {STEP_ORDER.map((name) => {
            const s = steps.find((x) => x.step === name);
            if (!s) return null;
            return (
              <li key={name} className="flex items-center gap-2 text-sm">
                {s.ok ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <X className="h-4 w-4 text-rose-400" />
                )}
                <span className={s.ok ? "text-neutral-200" : "text-rose-300"}>{name}</span>
                {s.detail && <span className="text-xs text-neutral-500">— {s.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {result?.evidenceId && (
        <div className="mt-4 rounded border border-emerald-800 bg-emerald-950/30 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-emerald-300">
                Evidence {result.evidenceId} — {result.status}
              </div>
              <div className="mt-1 font-mono text-xs text-neutral-400">
                sha256:{result.hash?.slice(0, 20)}…
              </div>
            </div>
            <Link
              href={`/evidence/${result.evidenceId}`}
              className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40"
            >
              View record →
            </Link>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
