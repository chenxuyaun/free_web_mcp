import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { TransitionRegistryClient } from "../src/transition";
import { anvil, ANVIL_PRIVATE_KEY, CLAIM_STATE_ENUM } from "../src/chains";

// Requires a running Anvil instance:
//   anvil --port 8545
// and the TransitionRegistry deployed at the default address
// (forge script script/DeployTransition.s.sol --rpc-url http://127.0.0.1:8545 --broadcast).
// Skips when Anvil is unreachable.

const RPC = "http://127.0.0.1:8545";
const TRANSITION = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as `0x${string}`;

async function anvilReachable(): Promise<boolean> {
  try {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const skip = !(await anvilReachable());

const run = () => new TransitionRegistryClient({
  rpcUrl: RPC,
  chain: anvil,
  transitionAddress: TRANSITION,
  privateKey: ANVIL_PRIVATE_KEY as `0x${string}`,
});

const sha = (s: string) => `0x${createHash("sha256").update(s).digest("hex")}` as `0x${string}`;

describe.skipIf(skip)("TransitionRegistryClient (Anvil)", () => {
  it("reads the domain separator", async () => {
    const c = run();
    const sep = await c.domainSeparator();
    expect(sep).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("signs + records a claim state transition on-chain (EIP-712)", async () => {
    const c = run();
    const claimHash = sha(`claim-${Date.now()}`);
    const result = await c.recordTransition(claimHash, "OBSERVED", "SUPPORTED");
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.blockNumber).toBeGreaterThan(0n);

    const rec = await c.getTransition(claimHash);
    expect(rec.exists).toBe(true);
    expect(rec.fromState).toBe(CLAIM_STATE_ENUM.OBSERVED);
    expect(rec.toState).toBe(CLAIM_STATE_ENUM.SUPPORTED);
    // The signer must be the EIP-712 authority (anvil account #0).
    const signer = privateKeyToAccount(ANVIL_PRIVATE_KEY as `0x${string}`);
    expect(rec.signer.toLowerCase()).toBe(signer.address.toLowerCase());
    expect(rec.nonce).toBe(0n);
    expect(await c.nonceOf(claimHash)).toBe(1n);
  }, 30_000);

  it("advances the nonce per claim (replay protection)", async () => {
    const c = run();
    const claimHash = sha(`claim-nonce-${Date.now()}`);
    await c.recordTransition(claimHash, "SUPPORTED", "CHALLENGED");
    // Second transition on the same claim uses nonce 1 — a replay of the
    // first signature (nonce 0) would be rejected by the contract.
    await c.recordTransition(claimHash, "CHALLENGED", "DISPUTED");
    expect(await c.nonceOf(claimHash)).toBe(2n);
  }, 30_000);

  it("maps claim states to the on-chain enum", () => {
    expect(TransitionRegistryClient.stateNumber("DRAFT")).toBe(0);
    expect(TransitionRegistryClient.stateNumber("OBSERVED")).toBe(1);
    expect(TransitionRegistryClient.stateNumber("SUPPORTED")).toBe(2);
    expect(TransitionRegistryClient.stateNumber("CHALLENGED")).toBe(3);
    expect(TransitionRegistryClient.stateNumber("DISPUTED")).toBe(4);
    expect(TransitionRegistryClient.stateNumber("RESOLVED")).toBe(5);
    expect(TransitionRegistryClient.stateNumber("FINAL")).toBe(6);
    expect(TransitionRegistryClient.stateNumber("EXPIRED")).toBe(7);
    expect(() => TransitionRegistryClient.stateNumber("BOGUS")).toThrow();
  });
});
