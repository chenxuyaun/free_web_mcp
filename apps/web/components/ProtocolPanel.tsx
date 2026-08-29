"use client";

import { AlertTriangle, Check, Loader2, ShieldCheck, Swords, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/paths";

interface ClaimStateView {
  id: string;
  state: string;
  attestations: Array<{
    id: string;
    agent: string;
    decision: string;
    confidence: number;
    stake: string;
    slashed?: boolean;
    reward?: string;
    rationale?: string;
  }>;
  challenges: Array<{
    id: string;
    challenger: string;
    bond: string;
    state: string;
    reason?: string;
  }>;
  resolution: {
    result: boolean | null;
    finalProbability: number;
    method: string;
    resolvedAt: string;
  } | null;
  challengeDeadline: number | null;
}

const STATE_STYLE: Record<string, string> = {
  DRAFT: "bg-neutral-800 text-neutral-300",
  OBSERVED: "bg-sky-950 text-sky-300 border border-sky-800",
  SUPPORTED: "bg-emerald-950 text-emerald-300 border border-emerald-800",
  CHALLENGED: "bg-amber-950 text-amber-300 border border-amber-800",
  DISPUTED: "bg-orange-950 text-orange-300 border border-orange-800",
  RESOLVED: "bg-violet-950 text-violet-300 border border-violet-800",
  FINAL: "bg-green-900 text-green-200 border border-green-700",
};

const STATE_ICON: Record<string, React.ReactNode> = {
  OBSERVED: <ShieldCheck className="h-3 w-3" />,
  SUPPORTED: <Check className="h-3 w-3" />,
  CHALLENGED: <Swords className="h-3 w-3" />,
  RESOLVED: <AlertTriangle className="h-3 w-3" />,
};

export function ProtocolPanel({ id }: { id: string }) {
  const [state, setState] = useState<ClaimStateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Attest form
  const [agent, setAgent] = useState("0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4");
  const [decision, setDecision] = useState<"SUPPORTED" | "CONTRADICTED" | "UNCERTAIN">("SUPPORTED");
  const [confidence, setConfidence] = useState("0.9");
  const [stake, setStake] = useState("100000000000000000000");
  const [rationale, setRationale] = useState("");

  async function refresh() {
    const res = await fetch(`${BASE_PATH}/api/claims/${id}`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      setState(body.state);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function attest() {
    setBusy("attest");
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/claims/${id}/attest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent,
        decision,
        confidence: Number(confidence),
        stake,
        rationale: rationale || undefined,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      setError(body.error?.message ?? "Attestation failed");
    } else {
      await refresh();
    }
    setBusy(null);
  }

  async function challenge() {
    setBusy("challenge");
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/claims/${id}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenger: agent,
        bond: stake,
        reason: rationale || "Evidence does not support the claim",
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      setError(body.error?.message ?? "Challenge failed");
    } else {
      await refresh();
    }
    setBusy(null);
  }

  async function finalize() {
    setBusy("finalize");
    setError(null);
    const res = await fetch(`${BASE_PATH}/api/claims/${id}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      setError(body.error?.message ?? "Finalization failed");
    } else {
      await refresh();
    }
    setBusy(null);
  }

  const deadline = state?.challengeDeadline
    ? new Date(state.challengeDeadline * 1000).toLocaleString()
    : null;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Verification Protocol (V1)
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> loading claim state…
        </div>
      ) : !state ? (
        <div className="text-neutral-500">No claim state yet.</div>
      ) : (
        <div className="space-y-4">
          {/* State badge */}
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                STATE_STYLE[state.state] ?? "bg-neutral-800 text-neutral-300"
              }`}
            >
              {STATE_ICON[state.state] ?? null}
              {state.state}
            </span>
            {state.attestations.length > 0 && (
              <span className="text-xs text-neutral-500">
                {state.attestations.length} attestation{state.attestations.length === 1 ? "" : "s"}
              </span>
            )}
            {state.challenges.length > 0 && (
              <span className="text-xs text-amber-400">
                {state.challenges.length} challenge{state.challenges.length === 1 ? "" : "s"}
              </span>
            )}
            {deadline && (
              <span className="text-xs text-neutral-500">challenge window until {deadline}</span>
            )}
          </div>

          {/* Resolution */}
          {state.resolution && (
            <div className="rounded-md border border-violet-900 bg-violet-950/20 p-3 text-xs">
              <div className="mb-1 font-semibold text-violet-300">
                Resolution: {state.resolution.result === null ? "INDETERMINATE" : state.resolution.result ? "TRUE" : "FALSE"}{" "}
                <span className="font-normal text-violet-400">
                  ({Math.round(state.resolution.finalProbability * 100)}%, {state.resolution.method})
                </span>
              </div>
              <div className="text-violet-400">resolved {new Date(state.resolution.resolvedAt).toLocaleString()}</div>
            </div>
          )}

          {/* Attestations */}
          {state.attestations.length > 0 && (
            <div className="space-y-2">
              {state.attestations.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-md border p-3 text-xs ${
                    a.slashed === true
                      ? "border-rose-900 bg-rose-950/20"
                      : a.slashed === false
                        ? "border-emerald-900 bg-emerald-950/20"
                        : "border-neutral-800 bg-neutral-900"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-neutral-300">
                      {a.agent.slice(0, 10)}…{a.agent.slice(-6)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={a.decision === "SUPPORTED" ? "text-emerald-400" : a.decision === "CONTRADICTED" ? "text-rose-400" : "text-amber-400"}>
                        {a.decision}
                      </span>
                      <span className="text-neutral-500">{Math.round(a.confidence * 100)}%</span>
                      <span className="text-neutral-500">{Number(a.stake) / 1e18} VERI</span>
                      {a.slashed === true && (
                        <span className="text-rose-400">SLASHED</span>
                      )}
                      {a.slashed === false && a.reward && (
                        <span className="text-emerald-400">+{Number(a.reward) / 1e18}</span>
                      )}
                    </span>
                  </div>
                  {a.rationale && <div className="mt-1 text-neutral-500">{a.rationale}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {state.state === "OBSERVED" || state.state === "SUPPORTED" ? (
            <div className="space-y-3 rounded-md border border-neutral-800 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 text-xs text-neutral-500">
                  Agent (wallet / eip155:…)
                  <input
                    value={agent}
                    onChange={(e) => setAgent(e.target.value)}
                    className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-200"
                  />
                </label>
                <label className="text-xs text-neutral-500">
                  Decision
                  <select
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as typeof decision)}
                    className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200"
                  >
                    <option value="SUPPORTED">SUPPORTED</option>
                    <option value="CONTRADICTED">CONTRADICTED</option>
                    <option value="UNCERTAIN">UNCERTAIN</option>
                  </select>
                </label>
                <label className="text-xs text-neutral-500">
                  Confidence (0–1)
                  <input
                    value={confidence}
                    onChange={(e) => setConfidence(e.target.value)}
                    className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200"
                  />
                </label>
                <label className="col-span-2 text-xs text-neutral-500">
                  Stake (wei VERI)
                  <input
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-200"
                  />
                </label>
                <label className="col-span-2 text-xs text-neutral-500">
                  Rationale
                  <input
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="e.g. Reuters + SEC filing corroborate"
                    className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-200"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={attest}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {busy === "attest" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                  Submit attestation
                </button>
                {state.state === "SUPPORTED" && (
                  <button
                    onClick={challenge}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    {busy === "challenge" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Swords className="h-3 w-3" />}
                    Challenge
                  </button>
                )}
                <button
                  onClick={finalize}
                  disabled={busy !== null}
                  title="Closes the challenge window and anchors the resolution on-chain"
                  className="inline-flex items-center gap-1.5 rounded bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50"
                >
                  {busy === "finalize" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  Finalize + anchor
                </button>
              </div>
            </div>
          ) : null}

          {error && <div className="text-xs text-rose-400">{error}</div>}
        </div>
      )}
    </section>
  );
}
