import { describe, expect, it } from "vitest";
import { EvidenceRegistryClient } from "../src/registry";
import { anvil, ANVIL_PRIVATE_KEY } from "../src/chains";
import { createHash } from "node:crypto";

// These tests require a running Anvil instance:
//   anvil --port 8545
// and the EvidenceRegistry deployed at the default address
// (forge script script/Deploy.s.sol:DeployEvidenceRegistry --rpc-url http://127.0.0.1:8545 --broadcast).
// When Anvil is unreachable the suite skips instead of failing.

const RPC = "http://127.0.0.1:8545";
const REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as `0x${string}`;

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

const run = () => new EvidenceRegistryClient({
  rpcUrl: RPC,
  chain: anvil,
  registryAddress: REGISTRY,
  privateKey: ANVIL_PRIVATE_KEY as `0x${string}`,
  explorerUrl: "http://127.0.0.1:8545",
});

const sha = (s: string) => `0x${createHash("sha256").update(s).digest("hex")}` as `0x${string}`;

describe.skipIf(skip)("EvidenceRegistryClient (Anvil)", () => {
  it("reads the chain id (97 for BSC Testnet config, 31337 for anvil)", async () => {
    const c = run();
    const id = await c.getChainId();
    expect(id).toBe(31337);
  });

  it("detects the deployed contract", async () => {
    const c = run();
    expect(await c.hasContract()).toBe(true);
  });

  it("anchors an evidence hash and reads it back", async () => {
    const c = run();
    const hash = sha(`test-${Date.now()}`);
    const result = await c.anchorEvidence(hash, "free-web-mcp://test/1", "0.1.0");
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.blockNumber).toBeGreaterThan(0n);

    const exists = await c.exists(hash);
    expect(exists).toBe(true);

    const record = await c.getRecord(hash);
    expect(record.exists).toBe(true);
    // anvil account #0 (the private key we sign with)
    expect(record.submitter.toLowerCase()).toBe(
      "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".toLowerCase(),
    );
  });

  it("rejects duplicate anchoring (contract requires unique hash)", async () => {
    const c = run();
    const hash = sha(`dup-${Date.now()}`);
    await c.anchorEvidence(hash, "free-web-mcp://test/dup", "0.1.0");
    await expect(c.anchorEvidence(hash, "free-web-mcp://test/dup", "0.1.0")).rejects.toThrow();
  });

  it("returns a tx explorer url", () => {
    const c = run();
    const url = c.txUrl("0x" + "a".repeat(64) as `0x${string}`);
    expect(url).toBe("http://127.0.0.1:8545/tx/0x" + "a".repeat(64));
  });
});
