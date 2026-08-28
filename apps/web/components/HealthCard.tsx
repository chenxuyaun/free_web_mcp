import { CheckCircle2, XCircle } from "lucide-react";

export function HealthCard({ status }: { status: boolean }) {
  return (
    <div
      className={`rounded-lg border p-6 ${
        status
          ? "border-emerald-700 bg-emerald-950/30"
          : "border-rose-700 bg-rose-950/30"
      }`}
    >
      <div className="flex items-center gap-3">
        {status ? (
          <CheckCircle2 className="w-7 h-7 text-emerald-400" />
        ) : (
          <XCircle className="w-7 h-7 text-rose-400" />
        )}
        <div>
          <h2 className="text-2xl font-semibold">
            {status ? "System Online" : "System Offline"}
          </h2>
          <p className="text-sm text-neutral-400">
            {status
              ? "Core services responding. Continue to the next phase."
              : "At least one core service is unreachable. Check logs."}
          </p>
        </div>
      </div>
    </div>
  );
}
