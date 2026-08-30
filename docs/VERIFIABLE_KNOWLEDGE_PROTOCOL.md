# Verifiable Knowledge Protocol (VKP)

## Overview

The Verifiable Knowledge Protocol is a protocol layer built on top of the
Free Web MCP evidence network. It enables AI agents to produce, verify, and
economically attest to knowledge claims through a transparent, on-chain
anchored consensus mechanism.

**Core insight** (teacher's framework): an AI response should not carry a
bare hash, nor the whole evidence package — it carries a **Citation**:
claim + short quote + locator + hash + resolution state + on-chain anchor,
and anyone can expand it back to the original sources.

## Six Core Objects

| Object | Role | State machine |
| --- | --- | --- |
| Claim | The assertion being verified | DRAFT → OBSERVED → SUPPORTED → CHALLENGED → DISPUTED → RESOLVED → FINAL |
| Evidence | Supporting / contradicting sources with SHA-256 hashes | — |
| Attestation | A validator's economically-risked judgment (SUPPORTED / CONTRADICTED / UNCERTAIN + confidence 0..1 + VERI stake) | — |
| Challenge | A dispute bond against an attestation | OPEN → UPHELD / REJECTED / ESCALATED |
| Resolution | The final truth outcome (TRUE / FALSE / INDETERMINATE) | — |
| Citation | The compact verifiable reference envelope | — |

## Key Mechanisms

### 1. Optimistic Verification (V1)

When a claim receives its first attestation, a challenge window opens
(default 24h). If no challenge is raised, the attestation is optimistically
finalized. A challenge forces a consensus vote.

### 2. Staking & Slashing (V1, V6)

- Attestors stake VERI behind their judgment. At resolution, correct
  attestors get a reward (attestorRewardFraction × stake); wrong attestors
  are slashed.
- Challengers bond VERI. A winning challenger gets the bond back + a reward
  (challengerRewardFraction × bond); a losing challenger forfeits the bond.

### 3. Proper Scoring Rules (V1, V10)

Reputation is calibrated using strictly proper scoring rules:

- **Brier** (default): score = 1 − (p−o)² — quadratic penalty.
- **Log**: score = exp(−log(p)) = p(correct) — exponential penalty, punishes
  overconfident wrong answers harder.

Reputation = running average of the score, so 1.0 = perfectly calibrated.

### 4. Independence Scoring (V2, V2.5)

Validators that share the same **model**, **search provider**, **source
pages**, or **policy** are correlated. Independence is computed as:

- `correlation = 1.0` (same agent)
- `correlation += 0.7` (same model)
- `correlation += 0.5` (same search provider)
- `correlation += 0.5 × Jaccard(source_overlap)` (shared pages read)
- `correlation += 0.3` (same policy)
- capped at 1.0

`independence[i] = 1 − max(correlation with others)`

`effective_votes = Σ independence` — 100 same-model agents ≈ 1 information
source.

### 5. Reputation-Weighted Consensus (V3)

Consensus influence = stake × independence × (1 + reputation).

A perfectly calibrated validator (rep 1.0) carries 2× the weight of a
newcomer (rep 0). Reputation is clamped to [0,1] to prevent amplification
exploits.

### 6. Oracle Ladder (V4, V13, V14)

The resolution tier is computed dynamically based on dispute severity:

| Tier | Condition | Meaning |
| --- | --- | --- |
| L2_AI_VALIDATORS | |p−0.5| ≥ 0.1 | Clear consensus — AI validator vote is sufficient |
| L3_ECONOMIC_DISPUTE | 0.05 ≤ |p−0.5| < 0.1 | Sharp disagreement — dispute needs economic arbitration |
| L4_HUMAN_EXPERT | |p−0.5| < 0.05 | Extreme disagreement — human expert judgment needed |

When a claim is in the knife-edge band (L3/L4), it does **not** resolve to
a coin-flip TRUE/FALSE. Instead:
- The claim enters **DISPUTED** state (V14).
- Attestations remain unsettled; challenges become **ESCALATED** (bond held).
- More independent validators can attest.
- A decisive consensus (|p−0.5| ≥ 0.1) → **RESOLVED** with TRUE/FALSE.
- If still knife-edge, stays DISPUTED.

### 7. On-Chain Anchoring (V7)

The resolution root (SHA-256 over attestations + challenges + outcome) is
anchored on BSC Testnet via `EvidenceRegistry.resolveClaim`. Anyone can
verify the root matches the local state via `GET /api/claims/[id]/verify`.

### 8. Citation Envelope (V1, V15, V16)

The compact payload an AI response should carry:

```json
{
  "claimId": "EV-000026",
  "claimText": "…",
  "evidence": [{"id": "ev:1", "sha256": "abc", "source": "https://…"}],
  "resolution": {"state": "RESOLVED", "result": false, "finalProbability": 0.35},
  "anchor": {"evidenceHash": "0x…", "txHash": "0x…", "network": "BSC Testnet"}
}
```

Available via `GET /api/claims/[id]/citation` and MCP tool `get_citation`.

## MCP Tools (14 total)

| Tool | Description |
| --- | --- |
| web_search | Search the web (DuckDuckGo/Bing/Baidu) |
| web_fetch | Fetch and extract content from a URL |
| web_search_and_fetch | Search + fetch each result |
| web_summarize_with_sources | Fetch + extract + structure |
| extract_claims | Extract factual claims from text |
| find_counter_evidence | Generate counter-evidence search queries |
| create_evidence_record | Build an evidence package |
| get_evidence | Fetch an evidence package |
| get_claim_state | Fetch claim lifecycle state |
| get_citation | Fetch the citation envelope |
| attest_claim | Submit a staked validator judgment |
| challenge_claim | Dispute an attestation |
| finalize_claim | Close the challenge window and produce a resolution |
| verify_claim | Verify a resolution against the on-chain record |

## Live Endpoints

| Endpoint | Purpose |
| --- | --- |
| `https://yuncai.site/webmcp` | Dashboard |
| `https://yuncai.site/mcp` | MCP streamable-http transport |
| `https://yuncai.site/.well-known/mcp.json` | MCP discovery |

## Verification Chain

Each milestone (V1-V16) has been verified on the live deployment:

| Claim | What it proves |
| --- | --- |
| EV-000014 | Full lifecycle: create → attest → challenge → finalize → on-chain anchor |
| EV-000015 | Independence weighting flips outcome (two same-model vs one diverse) |
| EV-000018 | High-reputation validator flips consensus (V3) |
| EV-000019 | Knife-edge → L4_HUMAN_EXPERT escalation (V4) |
| EV-000021 | Challenge bond settlement — winner gets reward + rep (V6) |
| EV-000022 | Full lifecycle via MCP only (V8) |
| EV-000025 | INDETERMINATE — no false certainty (V13) |
| EV-000026 | DISPUTED → new validator → RESOLVED (V14) |