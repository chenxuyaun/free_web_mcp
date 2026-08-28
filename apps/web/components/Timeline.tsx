import { getEvidencePackage, listVotesForEvidence } from "@/lib/db";

export const dynamic = "force-dynamic";

interface TimelineEvent {
  time: string;
  label: string;
  detail?: string;
}

/** Lifecycle events for one evidence record (spec §21 "Timeline"). */
export function Timeline({ id }: { id: string }) {
  const pkg = getEvidencePackage(id);
  if (!pkg) return null;
  const votes = listVotesForEvidence(id);

  const events: TimelineEvent[] = [
    {
      time: pkg.provenance.createdAt,
      label: "Evidence created",
      detail: `status ${pkg.assessment.status}, confidence ${(pkg.assessment.confidence * 100).toFixed(0)}%`,
    },
  ];

  if (pkg.blockchain?.anchored) {
    events.push({
      time: pkg.provenance.createdAt, // anchoring time is not stored separately; creation order holds
      label: "Anchored on-chain",
      detail: `tx ${pkg.blockchain.txHash?.slice(0, 18)}… block ${pkg.blockchain.blockNumber}`,
    });
  }

  for (const v of votes) {
    events.push({
      time: v.createdAt,
      label: `${v.vote} by ${v.validator.slice(0, 10)}…`,
      detail: v.correct
        ? v.challengeOf
          ? `successful challenge of ${v.challengeOf.slice(0, 10)}…${v.rewardAmount ? ` · +${(BigInt(v.rewardAmount) / 10n ** 18n).toString()} VERI` : ""}`
          : `correct${v.rewardAmount ? ` · +${(BigInt(v.rewardAmount) / 10n ** 18n).toString()} VERI` : ""}`
        : "incorrect",
    });
  }

  events.sort((a, b) => a.time.localeCompare(b.time));

  return (
    <ol className="space-y-0">
      {events.map((e, i) => (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < events.length - 1 && (
            <span className="absolute left-[5px] top-4 h-full w-px bg-neutral-800" />
          )}
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-neutral-600 bg-neutral-800" />
          <div className="min-w-0">
            <div className="text-sm text-neutral-200">{e.label}</div>
            {e.detail && <div className="text-xs text-neutral-500">{e.detail}</div>}
            <div className="mt-0.5 font-mono text-[10px] text-neutral-600">{e.time}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
