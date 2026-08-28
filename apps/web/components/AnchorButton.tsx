"use client";

import { Anchor, Check, Loader2, X } from "lucide-react";
import { useState } from "react";

interface AnchorBlockchain {
  anchored: boolean;
  evidenceHash?: string;
  contractAddress?: string;
  network?: string;
  blockNumber?: number;
  txHash?: string;
  uri?: string;
}

export function AnchorButton({ id, alreadyAnchored }: { id: string; alreadyAnchored: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnchorBlockchain | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (alreadyAnchored || result?.anchored) {
    const tx = result?.txHash ?? "";
    const explorerBase = process.env.NEXT_PUBLIC_BSC_EXPLORER_URL;
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-5">
        <div className="flex items-center gap-2 text-amber-300">
          <Check className="h-5 w-5" />
          <span className="font-semibold">Evidence Anchored</span>
        </div>
        <div className="mt-3 space-y-1 font-mono text-xs text-neutral-300">
          <div>
            Hash: <span className="text-emerald-300">{tx || "—"}</span>
          </div>
          {result?.network && <div>Network: {result.network}</div>}
          {result?.blockNumber !== undefined && <div>Block: {result.blockNumber}</div>}
        </div>
        {explorerBase && tx && (
          <a
            href={`${explorerBase}/tx/${tx}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded border border-amber-700 px-3 py-1 text-xs text-amber-400 hover:bg-amber-950/40"
          >
            View on Explorer ↗
          </a>
        )}
      </div>
    );
  }

  return (
    <div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          <Anchor className="h-4 w-4" />
          Anchor Evidence
        </button>
      ) : (
        <div className="rounded-lg border border-amber-800 bg-amber-950/20 p-4">
          <p className="text-sm text-amber-200">
            This writes the evidence SHA-256 hash to the blockchain
            (EvidenceRegistry). This is a <strong>permanent, public</strong> on-chain record.
            Continue?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch(`/api/anchor/${id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: true }),
                  });
                  const data = (await res.json()) as {
                    success?: boolean;
                    blockchain?: AnchorBlockchain;
                    error?: { message?: string };
                  };
                  if (!res.ok || !data.success) {
                    setError(data.error?.message ?? `HTTP ${res.status}`);
                  } else if (data.blockchain) {
                    setResult(data.blockchain);
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-amber-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Anchor className="h-4 w-4" />}
              {busy ? "Anchoring…" : "Confirm & Anchor"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
