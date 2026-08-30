import { NextResponse } from "next/server";
import {
  assessmentToExpectedVote,
  getEvidencePackage,
  priorSupportExists,
  recordVote,
  type ValidatorVote,
} from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getVeriClient } from "@/lib/blockchain";

export const dynamic = "force-dynamic";

/** VERI reward per correct vote (test incentive, spec §26). */
const REWARD_BASE = 100n * 10n ** 18n; // 100 VERI per correct vote
const REWARD_CHALLENGE = 200n * 10n ** 18n; // 200 VERI per successful challenge

interface ValidateBody {
  validator: string; // wallet address of the validator
  vote: ValidatorVote;
  /** Chain write needs explicit confirm (spec §13). */
  confirm?: boolean;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = rateLimit(request, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: { type: "RATE_LIMITED", message: "Too many votes." } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: ValidateBody;
  try {
    body = (await request.json()) as ValidateBody;
  } catch {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  const validator = (body.validator ?? "").trim().toLowerCase();
  if (!validator.startsWith("0x") || validator.length !== 42) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "validator must be a 0x wallet address." } },
      { status: 400 },
    );
  }
  if (!["SUPPORT", "CONTRADICT", "UNCERTAIN"].includes(body.vote)) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: "vote must be SUPPORT/CONTRADICT/UNCERTAIN." } },
      { status: 400 },
    );
  }

  const pkg = getEvidencePackage(params.id);
  if (!pkg) {
    return NextResponse.json(
      { success: false, error: { type: "INVALID_URL", message: `Evidence ${params.id} not found.` } },
      { status: 404 },
    );
  }

  // Correctness is determined locally (vote vs assessment status).
  // Reward minting happens on-chain only when the vote is correct AND the
  // user explicitly confirms the chain write.
  const expected = assessmentToExpectedVote(pkg.assessment.status);
  const correct = body.vote === expected;
  // Challenge detection (spec §25-26): a correct CONTRADICT against evidence
  // another validator previously SUPPORTED is a successful challenge.
  const isChallenge =
    correct && body.vote === "CONTRADICT" && priorSupportExists(params.id, validator);
  // Successful challenges earn double (200 vs 100) — challenge reward tier.
  const reward = isChallenge ? REWARD_CHALLENGE : REWARD_BASE;

  let rewardAmount: string | null = null;
  let rewardTx: string | null = null;

  if (correct && body.confirm === true) {
    try {
      const mint = await getVeriClient().mint(validator as `0x${string}`, reward);
      rewardTx = mint.txHash;
      rewardAmount = reward.toString();
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error: {
            type: "RENDER_FAILED",
            message: `Reward mint failed: ${e instanceof Error ? e.message : String(e)}`,
          },
        },
        { status: 500 },
      );
    }
  }

  const vote = recordVote({
    evidenceId: params.id,
    validator,
    vote: body.vote,
    rewardAmount,
    rewardTx,
  });

  return NextResponse.json({
    success: true,
    vote,
    correct,
    expectedVote: expected,
    rewarded: rewardTx !== null,
    rewardAmount: rewardAmount ? `${(BigInt(rewardAmount) / 10n ** 18n).toString()} VERI` : null,
    rewardTx,
    challenge: isChallenge,
  });
}
