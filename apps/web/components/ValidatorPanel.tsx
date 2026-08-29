"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { BASE_PATH } from "@/lib/paths";

type Vote = "SUPPORT" | "CONTRADICT" | "UNCERTAIN";

interface VoteResult {
  success?: boolean;
  correct?: boolean;
  expectedVote?: string;
  rewarded?: boolean;
  rewardAmount?: string | null;
  rewardTx?: string | null;
  vote?: { vote: string; correct: boolean };
  error?: { message?: string };
}

const VOTE_LABEL: Record<Vote, string> = {
  SUPPORT: "Support ✓",
  CONTRADICT: "Contradict ✗",
  UNCERTAIN: "Uncertain ?",
};

export function ValidatorPanel({ id }: { id: string }) {
  const [validator, setValidator] = useState("0x60a0Ee9e28b609B740A3588121C7C2B34FE64eF4");
  const [busy, setBusy] = useState<Vote | null>(null);
  const [result, setResult] = useState<VoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReward, setConfirmReward] = useState(false);

  const cast = async (vote: Vote) => {
    setBusy(vote);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/validate/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validator, vote, confirm: confirmReward }),
      });
      const data = (await res.json()) as VoteResult;
      if (!res.ok || data.success === false) {
        setError(data.error?.message ?? `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Validator Vote</h3>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={confirmReward}
            onChange={(e) => setConfirmReward(e.target.checked)}
            className="accent-amber-500"
          />
          Mint VERI reward if correct (chain write)
        </label>
      </div>

      <label className="mt-3 block text-xs text-neutral-500">Your validator address</label>
      <input
        value={validator}
        onChange={(e) => setValidator(e.target.value)}
        className="mt-1 w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-1.5 font-mono text-xs text-neutral-200"
      />

      <div className="mt-3 flex gap-2">
        {(Object.keys(VOTE_LABEL) as Vote[]).map((v) => (
          <button
            key={v}
            type="button"
            disabled={busy !== null}
            onClick={() => cast(v)}
            className={`flex-1 rounded border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              v === "SUPPORT"
                ? "border-emerald-800 text-emerald-300 hover:bg-emerald-950/40"
                : v === "CONTRADICT"
                  ? "border-rose-800 text-rose-300 hover:bg-rose-950/40"
                  : "border-amber-800 text-amber-300 hover:bg-amber-950/40"
            }`}
          >
            {busy === v ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : VOTE_LABEL[v]}
          </button>
        ))}
      </div>

      {result && (
        <div
          className={`mt-3 rounded border p-3 text-sm ${
            result.correct
              ? "border-emerald-800 bg-emerald-950/30 text-emerald-200"
              : "border-rose-800 bg-rose-950/30 text-rose-200"
          }`}
        >
          {result.correct ? (
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>
                Correct — matched the system assessment ({result.expectedVote})
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <X className="h-4 w-4" />
              <span>
                Incorrect — system assessment was {result.expectedVote}, you voted{" "}
                {result.vote?.vote}
              </span>
            </div>
          )}
          {result.rewarded && (
            <div className="mt-2 border-t border-emerald-800 pt-2 text-xs text-emerald-300">
              🪙 Reward minted: <strong>{result.rewardAmount}</strong>
              <div className="mt-1 break-all font-mono">tx: {result.rewardTx}</div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
