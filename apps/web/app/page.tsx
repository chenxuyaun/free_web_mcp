import Link from "next/link";
import { DemoRunner } from "@/components/DemoRunner";
import { HealthCard } from "@/components/HealthCard";
import { StatusBoard } from "@/components/StatusBoard";
import { Milestones } from "@/components/Milestones";
import { StatsGrid } from "@/components/StatsGrid";
import { getStats } from "@/lib/db";
import { getSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function Home() {
  const status = await getSystemStatus();
  const stats = getStats();

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
        <h2 className="text-xl font-semibold mb-4">One-click Demo</h2>
        <DemoRunner />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Project Status</h2>
        <StatusBoard services={status.services} />
      </section>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Evidence Statistics</h2>
          <div className="flex gap-4 text-sm text-neutral-400">
            <Link href="/evidence" className="hover:text-neutral-200">
              View all evidence →
            </Link>
            <Link href="/validators" className="hover:text-neutral-200">
              Validator leaderboard →
            </Link>
          </div>
        </div>
        <StatsGrid stats={stats} />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">Project Progress</h2>
        <Milestones milestones={status.milestones} />
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold mb-4">VERI Test Token</h2>
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
              VERI
            </span>
            <span className="text-sm text-neutral-300">Verifiable Evidence</span>
            <span className="text-xs text-neutral-500">— BSC Testnet</span>
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs text-neutral-500">Token Address</div>
              <code className="break-all font-mono text-xs text-emerald-300">
                {process.env.VERI_TOKEN_ADDRESS ?? "not deployed"}
              </code>
            </div>
            <div>
              <div className="text-xs text-neutral-500">Initial Supply</div>
              <div className="font-mono text-xs">100,000,000 VERI</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Testnet-only reward token (spec §24-26). No DEX, no liquidity, no public
            sale. Used for validator rewards in the next phase.
          </p>
        </div>
      </section>

      <footer className="mt-16 text-xs text-neutral-600">
        <p>
          Status probes are live system checks, not hard-coded values.{" "}
          <code className="text-neutral-400">/api/health</code> exposes the same
          payload as JSON.
        </p>
      </footer>
    </main>
  );
}
