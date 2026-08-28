import Link from "next/link";
import { EvidenceRegistryClient } from "@free-web-mcp/blockchain";
import { getRegistryConfig } from "@/lib/blockchain";
import { listEvidence, getEvidencePackage } from "@/lib/db";

export const dynamic = "force-dynamic";

interface FeedRecord {
  evidenceId: string;
  evidenceHash: string;
  txHash: string | null;
  blockNumber: number | null;
  verifiedOnChain: boolean;
  txUrl: string | null;
}

/** On-chain anchor feed: SQLite-indexed, chain-verified per record (M1C). */
export async function ChainRecords() {
  const records: FeedRecord[] = [];
  let error: string | null = null;

  try {
    const client = new EvidenceRegistryClient(getRegistryConfig());
    const anchored = listEvidence().filter(
      (e) => e.anchored && getEvidencePackage(e.id)?.blockchain?.network === client.chain.name,
    ).slice(0, 5);
    for (const e of anchored) {
      const pkg = getEvidencePackage(e.id);
      const bc = pkg?.blockchain;
      const onChain = bc?.evidenceHash
        ? await client.exists(`0x${bc.evidenceHash.replace(/^0x/, "")}` as `0x${string}`)
        : false;
      records.push({
        evidenceId: e.id,
        evidenceHash: bc?.evidenceHash ?? e.hash,
        txHash: bc?.txHash ?? null,
        blockNumber: bc?.blockNumber ?? null,
        verifiedOnChain: onChain,
        txUrl: bc?.txHash && client.explorerUrl ? `${client.explorerUrl}/tx/${bc.txHash}` : null,
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <h3 className="font-semibold">On-chain Anchors</h3>
      <p className="mt-1 text-xs text-neutral-500">
        Anchored evidence hashes, each re-verified with a live chain read (exists()).
      </p>

      {error ? (
        <p className="mt-3 text-xs text-neutral-500">Chain feed unavailable: {error}</p>
      ) : records.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-500">
          Nothing anchored yet — open an evidence record and click Anchor Evidence.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {records.map((r) => (
            <li key={r.evidenceId} className="text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/evidence/${r.evidenceId}`}
                  className="font-mono text-neutral-400 hover:text-neutral-200"
                >
                  {r.evidenceId}
                </Link>
                <code className="break-all font-mono text-emerald-300">
                  0x{r.evidenceHash.replace(/^0x/, "").slice(0, 28)}…
                </code>
                {r.verifiedOnChain && (
                  <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    ✓ chain
                  </span>
                )}
                {r.txUrl && (
                  <a href={r.txUrl} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">
                    tx ↗
                  </a>
                )}
                {r.blockNumber !== null && (
                  <span className="ml-auto text-neutral-600">block {r.blockNumber}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-neutral-800 pt-2 text-xs text-neutral-500">
        Anchoring is one click from any{" "}
        <Link href="/evidence" className="underline hover:text-neutral-300">
          evidence record
        </Link>
        .
      </div>
    </div>
  );
}
