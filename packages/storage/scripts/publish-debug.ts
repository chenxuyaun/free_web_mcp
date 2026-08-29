/** Full publish flow with verbose logging (debug harness, no Next). */
import { GreenfieldPublisher } from "../src/greenfield";

async function main() {
  const pk = process.env.WALLET_PRIVATE_KEY as `0x${string}`;
  const p = new GreenfieldPublisher({
    rpcUrl: "https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org",
    chainId: "5600",
    bucket: process.env.GREENFIELD_BUCKET || "free-web-mcp-evidence2",
    privateKey: pk,
    accountAddress: process.env.E2E_ADDRESS! as `0x${string}`,
    spEndpoint: "https://gnfd-testnet-sp1.bnbchain.org",
  });

  const json = JSON.stringify({
    debug: true,
    publishedAt: new Date().toISOString(),
    note: "free-web-mcp publish smoke test v2 (reachable SP)",
  });

  console.log("→ ensureBucket (reachability-selected SP)…");
  await p.ensureBucket();
  console.log("✓ bucket ready");

  console.log("→ publish (createObject + PUT + seal)…");
  const result = await p.publish(json);
  console.log("✓ PUBLISHED");
  console.log("   uri:", result.uri);
  console.log("   tx:", result.txHash);
  console.log("   contentHash:", result.contentHash);

  console.log("→ retrievability check…");
  console.log(await p.isRetrievable(result.uri) ? "✓ publicly retrievable" : "✗ NOT retrievable yet");
}

main().catch((e) => { console.error("PUBLISH FAILED:", e.message ?? e); process.exit(1); });
