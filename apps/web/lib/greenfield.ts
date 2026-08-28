import "server-only";

import { GreenfieldPublisher, DEFAULT_GREENFIELD_CONFIG } from "@free-web-mcp/storage";
import { privateKeyToAccount } from "viem/accounts";

const globalForGf = globalThis as unknown as { __gfPublisher?: GreenfieldPublisher };

export function getGreenfieldPublisher(): GreenfieldPublisher {
  if (globalForGf.__gfPublisher) return globalForGf.__gfPublisher;

  const bucket = process.env.GREENFIELD_BUCKET;
  const privKey = process.env.WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  if (!bucket || !privKey) {
    throw new Error(
      "Greenfield not configured — set GREENFIELD_BUCKET and WALLET_PRIVATE_KEY in .env.local",
    );
  }

  const publisher = new GreenfieldPublisher({
    rpcUrl: process.env.GREENFIELD_RPC || DEFAULT_GREENFIELD_CONFIG.rpcUrl,
    chainId: process.env.GREENFIELD_CHAIN_ID || DEFAULT_GREENFIELD_CONFIG.chainId,
    bucket,
    privateKey: privKey,
    accountAddress: privateKeyToAccount(privKey).address,
    spEndpoint: process.env.GREENFIELD_SP_ENDPOINT || DEFAULT_GREENFIELD_CONFIG.spEndpoint,
  });
  globalForGf.__gfPublisher = publisher;
  return publisher;
}
