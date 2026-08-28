"use client";

import { BadgeCheck, Check, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";

interface Registration {
  agentId: string;
  txHash: string;
  agentURI: string;
  identityAddress: string;
}

interface RegisterResponse {
  success?: boolean;
  registration?: Registration;
  alreadyRegistered?: boolean;
  txUrl?: string | null;
  error?: { message?: string };
}

export function AgentCard({ registration }: { registration: Registration | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const reg = registration ?? result?.registration ?? null;
  const txUrl = result?.txUrl ?? null;

  if (reg) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-emerald-400" />
          <h3 className="font-semibold">ERC-8004 Agent Identity</h3>
          <span className="rounded bg-emerald-950 px-2 py-0.5 text-xs text-emerald-400">
            registered
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <div>
            <div className="text-xs text-neutral-500">Agent ID</div>
            <div className="font-mono text-xs text-emerald-300">#{reg.agentId}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Registry</div>
            <code className="break-all font-mono text-xs text-neutral-400">
              {reg.identityAddress}
            </code>
          </div>
        </div>
        <div className="mt-2">
          <div className="text-xs text-neutral-500">agentURI</div>
          <a
            href={reg.agentURI}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all font-mono text-xs text-neutral-300 hover:text-neutral-100"
          >
            {reg.agentURI} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Spec §28: on-chain identity is the anchor for evidence reputation — validator
          feedback will attach to this agentId (feedback writing lands with the
          second-wallet flow).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-5 w-5 text-neutral-500" />
        <h3 className="font-semibold">ERC-8004 Agent Identity</h3>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
          not registered
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-400">
        Register "Free Web MCP" as an on-chain agent (ERC-8004 Identity Registry, BSC
        Testnet). No contract deployment — one transaction against the official
        registry.
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          Register Agent
        </button>
      ) : (
        <div className="mt-3 rounded border border-emerald-800 bg-emerald-950/20 p-3">
          <p className="text-sm text-emerald-200">
            Mints an ERC-8004 agent identity (NFT) on BSC Testnet. Continue?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch("/api/agent/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: true }),
                  });
                  const data = (await res.json()) as RegisterResponse;
                  if (!res.ok || data.success === false) {
                    setError(data.error?.message ?? `HTTP ${res.status}`);
                  } else {
                    setResult(data);
                    setConfirming(false);
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {busy ? "Registering…" : "Confirm & Register"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      {txUrl && (
        <a
          href={txUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-amber-400 hover:underline"
        >
          View registration tx ↗
        </a>
      )}
    </div>
  );
}
