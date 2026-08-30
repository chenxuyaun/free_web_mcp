"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/paths";

/** Client component that fetches the citation envelope (§19-§22) and provides
 *  a one-click copy for AI consumption. The teacher's framework: an AI
 *  response should not carry the whole evidence package — it carries a
 *  Citation (claim + short quote + locator + hash), and an AI reader can
 *  expand it back to the full package. */
export function CitationEnvelope({ id }: { id: string }) {
  const [citation, setCitation] = useState<object | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${BASE_PATH}/api/claims/${id}/citation`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setCitation(d.citation ?? d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const json = citation ? JSON.stringify(citation, null, 2) : "";

  async function copy() {
    if (!json) return;
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Verifiable reference envelope (teacher §19-§22). An AI response should
        carry this Citation instead of the full evidence package — any reader
        can expand it back to the original sources and resolution.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> loading citation…
        </div>
      ) : citation ? (
        <div className="space-y-2">
          <pre className="max-h-48 overflow-auto rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
            {json.slice(0, 3000)}
            {json.length > 3000 ? "\n… (truncated)" : ""}
          </pre>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-700"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy Citation
              </>
            )}
          </button>
        </div>
      ) : (
        <p className="text-xs text-neutral-500">Citation not available for this claim.</p>
      )}
    </div>
  );
}