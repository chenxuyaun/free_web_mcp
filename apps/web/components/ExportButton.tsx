"use client";

import { Download } from "lucide-react";
import { BASE_PATH } from "@/lib/paths";

/** Download the full Evidence Package as JSON (Phase E). */
export function ExportButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={async () => {
        const res = await fetch(`${BASE_PATH}/api/evidence/${id}`);
        const data = await res.json();
        const pkg = data.package ?? data;
        const blob = new Blob([JSON.stringify(pkg, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="inline-flex items-center gap-1 rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
    >
      <Download className="h-3 w-3" />
      Export JSON
    </button>
  );
}
