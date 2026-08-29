/** Check status of a published object + try public GETs on known SP endpoints. */
import { Client } from "@bnb-chain/greenfield-js-sdk";

const RPC = "https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org";
const CHAIN_ID = "5600";
const BUCKET = "free-web-mcp-evidence";
const OBJECT = process.env.OBJECT_NAME!;

async function main() {
  const client = Client.create(RPC, CHAIN_ID);

  // 1. on-chain object status
  try {
    const head = (await client.object.headObject(BUCKET, OBJECT)) as {
      objectInfo?: { objectStatus?: string | number; primarySpAddress?: string };
    };
    console.log("headObject:", JSON.stringify(head.objectInfo ?? head, null, 1).slice(0, 400));
  } catch (e) {
    console.log("headObject failed:", (e as Error).message.slice(0, 200));
  }

  // 2. try public GETs across testnet SP endpoints
  const endpoints = [
    "https://gnfd-testnet-sp1.bnbchain.org",
    "https://gnfd-testnet-sp2.bnbchain.org",
    "https://gnfd-testnet-sp3.bnbchain.org",
    "https://gnfd-sp.4everland.org",
    "https://gnfd-testnet-sp3.nodereal.io",
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${ep}/view/${BUCKET}/${OBJECT}`, { signal: AbortSignal.timeout(8000) });
      const text = r.ok ? await r.text() : "";
      console.log(`${r.ok ? "✓" : "✗"} ${ep}/view/... status=${r.status} len=${text.length}`);
      if (r.ok) {
        console.log("  body head:", text.slice(0, 120));
        break;
      }
    } catch (e) {
      console.log(`✗ ${ep}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
