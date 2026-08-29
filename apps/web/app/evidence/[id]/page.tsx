import Link from "next/link";
import { notFound } from "next/navigation";
import { AnchorButton } from "@/components/AnchorButton";
import { PublishButton } from "@/components/PublishButton";
import { CopyButton } from "@/components/CopyButton";
import { ExportButton } from "@/components/ExportButton";
import { Timeline } from "@/components/Timeline";
import { ValidatorPanel } from "@/components/ValidatorPanel";
import { ProtocolPanel } from "@/components/ProtocolPanel";
import { getEvidencePackage } from "@/lib/db";

export const dynamic = "force-dynamic";

const statusColor: Record<string, string> = {
  SUPPORTED: "text-emerald-400 border-emerald-800 bg-emerald-950/40",
  LIKELY_TRUE: "text-emerald-300 border-emerald-900 bg-emerald-950/30",
  UNCERTAIN: "text-amber-400 border-amber-800 bg-amber-950/30",
  CONTRADICTED: "text-rose-400 border-rose-800 bg-rose-950/30",
  INSUFFICIENT_EVIDENCE: "text-neutral-400 border-neutral-700 bg-neutral-900",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function EvidenceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const pkg = getEvidencePackage(params.id);
  if (!pkg) notFound();

  const explorerBase = process.env.BSC_EXPLORER_URL;
  const bc = pkg.blockchain;
  const explorerTxUrl =
    bc?.anchored && bc.txHash && explorerBase ? `${explorerBase}/tx/${bc.txHash}` : null;

  const v = pkg.verification;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/evidence" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← All evidence
        </Link>
        <div className="flex items-center gap-2">
          <ExportButton id={pkg.id} />
          <span className="font-mono text-sm text-neutral-500">{pkg.id}</span>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span
          className={`rounded border px-3 py-1 text-sm font-semibold ${
            statusColor[pkg.assessment.status] ?? "text-neutral-400 border-neutral-700"
          }`}
        >
          {pkg.assessment.status}
        </span>
        <span className="text-sm text-neutral-400">
          Confidence {(pkg.assessment.confidence * 100).toFixed(0)}%
        </span>
        <span className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">
          {pkg.claim.type}
        </span>
        {bc?.anchored && (
          <span className="text-sm font-semibold text-amber-400">⛓ Anchored on-chain</span>
        )}
      </div>

      <Section title="Claim">
        <p className="text-base text-neutral-100">{pkg.claim.text}</p>
      </Section>

      <Section title="Verification">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{v.supportingSources}</div>
            <div className="text-xs text-neutral-500">Supporting Sources</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {v.contradictingSources}
            </div>
            <div className="text-xs text-neutral-500">Counter Evidence</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{v.independentSources}</div>
            <div className="text-xs text-neutral-500">Independent Sources</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{v.duplicateSources}</div>
            <div className="text-xs text-neutral-500">Duplicate Sources</div>
          </div>
          <div>
            <div className="text-sm">{v.crossVerified ? "✓ yes" : "✗ no"}</div>
            <div className="text-xs text-neutral-500">Cross-verified</div>
          </div>
          <div>
            <div className="text-sm">{v.sourceTraceable ? "✓ yes" : "✗ no"}</div>
            <div className="text-xs text-neutral-500">Source traceable</div>
          </div>
        </div>
      </Section>

      <Section title="Evidence Hash (SHA-256 of canonical JSON)">
        <div className="flex flex-wrap items-center gap-3">
          <code className="break-all rounded bg-neutral-950 p-2 font-mono text-xs text-emerald-300">
            {bc?.evidenceHash ?? pkg.provenance.hashAlgorithm}
          </code>
          <CopyButton text={pkg.provenance.hashAlgorithm} label="Copy Hash" />
        </div>
      </Section>

      <Section title={`Sources (${pkg.sources.length})`}>
        <ul className="space-y-2">
          {pkg.sources.map((s, i) => (
            <li key={`${s.url}-${i}`} className="text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                  {s.sourceType}
                </span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-200 underline-offset-2 hover:underline"
                >
                  {s.title}
                </a>
              </div>
              <div className="mt-0.5 font-mono text-xs text-neutral-600">
                {s.url}
                {s.publishedAt ? ` · published ${s.publishedAt.slice(0, 10)}` : ""}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Counter Evidence Search Directions">
        {pkg.counterEvidence.searches.length === 0 ? (
          <p className="text-sm text-neutral-500">None generated.</p>
        ) : (
          <ul className="space-y-1">
            {pkg.counterEvidence.searches.map((q, i) => (
              <li key={i} className="font-mono text-xs text-neutral-400">
                {q}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Verification Protocol (V1)">
        <ProtocolPanel id={pkg.id} />
      </Section>

      <Section title="Validator Vote (spec §25-26)">
        <ValidatorPanel id={pkg.id} />
      </Section>

      <Section title="Timeline">
        <Timeline id={pkg.id} />
      </Section>

      <Section title="Decentralized Storage (Greenfield, spec §27)">
        <PublishButton id={pkg.id} publishedUri={pkg.storage?.uri ?? null} />
      </Section>

      <Section title="Blockchain">
        {!bc?.anchored ? (
          <div className="space-y-4">
            <p className="text-sm text-neutral-500">
              Not anchored yet. The SHA-256 hash of this evidence package can be
              registered on the EvidenceRegistry contract (BSC Testnet / Anvil) —
              the record becomes a permanent, public fingerprint.
            </p>
            <AnchorButton id={pkg.id} alreadyAnchored={false} />
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-xs text-neutral-500">Transaction</div>
                <code className="font-mono text-xs text-emerald-300">{bc.txHash}</code>
              </div>
              <CopyButton text={bc.txHash ?? ""} label="Copy TX" />
              {explorerTxUrl && (
                <a
                  href={explorerTxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-amber-700 px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-950/40"
                >
                  View on Explorer ↗
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs text-neutral-500">Network</div>
                <div className="text-sm">{bc.network}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Block</div>
                <div className="text-sm tabular-nums">{bc.blockNumber}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-neutral-500">Contract</div>
                <code className="font-mono text-xs">{bc.contractAddress}</code>
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Provenance">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div>
            <div className="text-xs text-neutral-500">Engine Version</div>
            <div className="font-mono text-xs">{pkg.provenance.engineVersion}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Created At</div>
            <div className="font-mono text-xs">{pkg.provenance.createdAt}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Hash Algorithm</div>
            <div className="font-mono text-xs">{pkg.provenance.hashAlgorithm}</div>
          </div>
        </div>
      </Section>
    </main>
  );
}
