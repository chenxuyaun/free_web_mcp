import { EvidenceStats } from "@/lib/db";

const LABELS: Array<{ key: keyof EvidenceStats; label: string }> = [
  { key: "totalClaims", label: "Claims" },
  { key: "totalEvidence", label: "Evidence" },
  { key: "verifiedClaims", label: "Verified" },
  { key: "counterEvidenceFound", label: "Counter Evidence" },
  { key: "onChainRecords", label: "On-chain Records" },
];

export function StatsGrid({ stats }: { stats: EvidenceStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {LABELS.map(({ key, label }) => (
        <div
          key={key}
          className="rounded-md border border-neutral-800 bg-neutral-900/50 px-4 py-3"
        >
          <div className="text-2xl font-semibold tabular-nums">{stats[key]}</div>
          <div className="text-xs text-neutral-500">{label}</div>
        </div>
      ))}
    </div>
  );
}
