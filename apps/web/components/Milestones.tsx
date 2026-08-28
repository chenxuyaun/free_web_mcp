import { MilestoneRow } from "@/lib/status";
import { Check, Circle } from "lucide-react";

export function Milestones({ milestones }: { milestones: MilestoneRow[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {milestones.map((m) => (
        <div
          key={m.key}
          className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2"
        >
          {m.done ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Circle className="w-4 h-4 text-neutral-500" />
          )}
          <span className={`text-sm ${m.done ? "text-emerald-200" : "text-neutral-400"}`}>{m.label}</span>
        </div>
      ))}
    </div>
  );
}
