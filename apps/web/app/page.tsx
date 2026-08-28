import { HealthCard } from "@/components/HealthCard";
import { StatusBoard } from "@/components/StatusBoard";
import { Milestones } from "@/components/Milestones";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await getSystemStatus();

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <header className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight">Free Web MCP</h1>
        <p className="mt-2 text-neutral-400 text-sm">
          Verifiable Web Evidence Network — MCP server + evidence engine +
          on-chain anchoring (BSC Testnet)
        </p>
      </header>

      <HealthCard status={status.systemOnline} />

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Project Status</h2>
        <StatusBoard services={status.services} />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Project Progress</h2>
        <Milestones milestones={status.milestones} />
      </section>

      <footer className="mt-16 text-xs text-neutral-600">
        <p>
          Phase 0 MVP — the dashboard reads live system state, no hard-coded
          status. <code className="text-neutral-400">/api/health</code> exposes the
          same payload as JSON.
        </p>
      </footer>
    </main>
  );
}
