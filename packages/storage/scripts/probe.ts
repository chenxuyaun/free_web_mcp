/** Gas-free Greenfield connectivity probe. */
import { Client } from "@bnb-chain/greenfield-js-sdk";

const RPC = "https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org";
const CHAIN_ID = "5600";

async function main() {
  const account = { address: process.env.E2E_ADDRESS! } as { address: `0x${string}` };
  if (!account.address) throw new Error("set E2E_ADDRESS");
  console.log("1. address:", account.address);

  const client = Client.create(RPC, CHAIN_ID);
  console.log("2. client created against", RPC);

  const sps = await client.sp.getStorageProviders();
  console.log(`3. storage providers: ${sps.length}`);
  console.log("   primary candidate:", sps[0]?.operatorAddress, "| endpoint:", sps[0]?.endpoint);

  const bucket = "free-web-mcp-evidence";
  try {
    const head = await client.bucket.headBucket(bucket);
    console.log("4. headBucket: EXISTS ->", JSON.stringify(head).slice(0, 120));
  } catch (e) {
    console.log("4. headBucket: not found yet (expected on first run) ->", (e as Error).message.slice(0, 100));
  }

  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [account.address, "latest"] }),
  });
  const j = await res.json();
  const wei = BigInt(j.result ?? "0");
  console.log(`5. Greenfield balance: ${Number(wei) / 1e18} tBNB ${wei === 0n ? "(bridging pending)" : "(ready)"}`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e.message ?? e);
  process.exit(1);
});
