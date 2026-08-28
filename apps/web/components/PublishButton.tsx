"use client";

import { Check, ExternalLink, Loader2, CloudUpload, X } from "lucide-react";
import { useState } from "react";

interface PublishResult {
  success?: boolean;
  uri?: string;
  contentHash?: string;
  retrievable?: boolean;
  error?: { message?: string };
}

export function PublishButton({ id, publishedUri }: { id: string; publishedUri: string | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uri = publishedUri ?? result?.uri ?? null;

  if (uri) {
    return (
      <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3">
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <Check className="h-4 w-4" />
          Published to BNB Greenfield
        </div>
        <a
          href={uri}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 break-all font-mono text-xs text-emerald-400 hover:underline"
        >
          Decentralized proof ↗ <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  return (
    <div>
      {!busy ? (
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch(`/api/evidence/${id}/publish`, { method: "POST" });
              const data = (await res.json()) as PublishResult;
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
          className="inline-flex items-center gap-2 rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-950/40"
        >
          <CloudUpload className="h-4 w-4" />
          Publish to Greenfield
        </button>
      ) : (
        <div className="inline-flex items-center gap-2 rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading + waiting for seal (~10-30s)…
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-rose-400">
          <X className="mr-1 inline h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
