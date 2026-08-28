import { ServiceRow } from "@/lib/status";
import { CheckCircle2, XCircle, PlugZap, Unplug } from "lucide-react";

const statusIcon: Record<string, JSX.Element> = {
  ONLINE: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
  CONNECTED: <PlugZap className="w-5 h-5 text-emerald-400" />,
  OFFLINE: <XCircle className="w-5 h-5 text-rose-400" />,
  DISCONNECTED: <Unplug className="w-5 h-5 text-amber-400" />,
};

const statusColor: Record<string, string> = {
  ONLINE: "text-emerald-400",
  CONNECTED: "text-emerald-400",
  OFFLINE: "text-rose-400",
  DISCONNECTED: "text-amber-400",
};

export function StatusBoard({ services }: { services: ServiceRow[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {services.map((s) => (
        <div
          key={s.key}
          className="rounded-md border border-neutral-800 bg-neutral-900/50 px-4 py-3 flex items-center gap-3"
        >
          {statusIcon[s.status] ?? <XCircle className="w-5 h-5 text-neutral-500" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{s.label}</div>
            {s.detail && (
              <div className="text-xs text-neutral-500 truncate">{s.detail}</div>
            )}
          </div>
          <span className={`text-xs font-semibold ${statusColor[s.status] ?? "text-neutral-400"}`}>
            {s.status}
          </span>
        </div>
      ))}
    </div>
  );
}
