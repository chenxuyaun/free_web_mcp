import "server-only";

import { anvil, bscTestnet, EvidenceRegistryClient } from "@free-web-mcp/blockchain";
import type { Chain, Hex } from "viem";

export interface RegistryConfig {
  rpcUrl: string;
  chain: Chain;
  registryAddress: Hex;
  privateKey?: Hex;
  explorerUrl?: string;
}

function resolveChain(idOrName: string | undefined): Chain {
  const n = (idOrName ?? "bsc-testnet").toLowerCase();
  if (n === "anvil" || n === "localhost" || n === "31337") return anvil;
  return bscTestnet;
}

export function getRegistryConfig(): RegistryConfig {
  const rpcUrl = process.env.BSC_RPC_URL;
  const address = process.env.EVIDENCE_REGISTRY_ADDRESS;
  if (!rpcUrl || !address) {
    throw new Error(
      "Blockchain not configured — set BSC_RPC_URL and EVIDENCE_REGISTRY_ADDRESS in .env",
    );
  }
  return {
    rpcUrl,
    chain: resolveChain(process.env.BSC_NETWORK),
    registryAddress: address as Hex,
    privateKey: (process.env.WALLET_PRIVATE_KEY || undefined) as Hex | undefined,
    explorerUrl: process.env.BSC_EXPLORER_URL || undefined,
  };
}

/** Lazily-created singleton so every request doesn't spin a new viem client. */
const globalForBlockchain = globalThis as unknown as { __registryClient?: EvidenceRegistryClient };

export function getRegistryClient(): EvidenceRegistryClient {
  if (globalForBlockchain.__registryClient) return globalForBlockchain.__registryClient;
  const cfg = getRegistryConfig();
  const client = new EvidenceRegistryClient(cfg);
  globalForBlockchain.__registryClient = client;
  return client;
}
