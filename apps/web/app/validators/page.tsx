import Link from "next/link";
import { listValidators, listVotes } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function ValidatorsPage() {
  const validators = listValidators();
  const recentVotes = listVotes();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Validator Leaderboard</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {validators.length} validator{validators.length === 1 ? "" : "s"} — reputation
            from vote accuracy (spec §25)
          </p>
        </div>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Dashboard
        </Link>
      </div>

      {validators.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-800 p-10 text-center text-neutral-500">
          No validators yet. Cast a vote on any{" "}
          <Link href="/evidence" className="text-neutral-300 underline">
            evidence record
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Validator</th>
                <th className="px-4 py-3 text-right">Reputation</th>
                <th className="px-4 py-3 text-right">Verified</th>
                <th className="px-4 py-3 text-right">Challenges</th>
                <th className="px-4 py-3 text-right">Total Votes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {validators.map((v, i) => (
                <tr key={v.address} className="hover:bg-neutral-900/50">
                  <td className="px-4 py-3 text-neutral-500">{i + 1}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    {v.address.slice(0, 10)}…{v.address.slice(-8)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-400">
                    {v.reputation}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{v.verifiedClaims}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-400">
                    {v.successfulChallenges}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{v.totalVotes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 mb-4 text-xl font-semibold">Recent Votes</h2>
      {recentVotes.length === 0 ? (
        <p className="text-sm text-neutral-500">No votes yet.</p>
      ) : (
        <ul className="space-y-2">
          {recentVotes.slice(0, 10).map((v) => (
            <li
              key={v.id}
              className="rounded-md border border-neutral-800 bg-neutral-900/50 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href={`/evidence/${v.evidenceId}`}
                  className="font-mono text-neutral-400 hover:text-neutral-200"
                >
                  {v.evidenceId}
                </Link>
                <span
                  className={`rounded px-1.5 py-0.5 font-semibold ${
                    v.vote === "SUPPORT"
                      ? "bg-emerald-950 text-emerald-300"
                      : v.vote === "CONTRADICT"
                        ? "bg-rose-950 text-rose-300"
                        : "bg-amber-950 text-amber-300"
                  }`}
                >
                  {v.vote}
                </span>
                <span className={v.correct ? "text-emerald-400" : "text-rose-400"}>
                  {v.correct ? "correct" : "incorrect"}
                </span>
                {v.challengeOf && (
                  <span className="text-amber-400">⚔ challenge of {v.challengeOf.slice(0, 10)}…</span>
                )}
                {v.rewardAmount && (
                  <span className="text-neutral-500">
                    +{(BigInt(v.rewardAmount) / 10n ** 18n).toString()} VERI
                  </span>
                )}
                <span className="ml-auto text-neutral-600">
                  {v.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
