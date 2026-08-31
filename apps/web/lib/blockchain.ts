import "server-only";

import { anvil, bscTestnet, EvidenceRegistryClient, TransitionRegistryClient, VeriClient } from "@free-web-mcp/blockchain";
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
const globalForBlockchain = globalThis as unknown as {
  __registryClient?: EvidenceRegistryClient;
  __veriClient?: VeriClient;
  __transitionClient?: TransitionRegistryClient;
};

export function getRegistryClient(): EvidenceRegistryClient {
  if (globalForBlockchain.__registryClient) return globalForBlockchain.__registryClient;
  const cfg = getRegistryConfig();
  const client = new EvidenceRegistryClient(cfg);
  globalForBlockchain.__registryClient = client;
  return client;
}

/** V26: lazily-created VeriClient singleton for on-chain VERI minting.
 *  Requires VERI_TOKEN_ADDRESS, BSC_RPC_URL, and WALLET_PRIVATE_KEY. */
export function getVeriClient(): VeriClient {
  if (globalForBlockchain.__veriClient) return globalForBlockchain.__veriClient;
  const rpcUrl = process.env.BSC_RPC_URL;
  const veriAddress = process.env.VERI_TOKEN_ADDRESS;
  if (!rpcUrl || !veriAddress) {
    throw new Error("VERI minting not configured — set BSC_RPC_URL and VERI_TOKEN_ADDRESS in .env");
  }
  const client = new VeriClient({
    rpcUrl,
    chain: resolveChain(process.env.BSC_NETWORK),
    veriAddress: veriAddress as Hex,
    privateKey: (process.env.WALLET_PRIVATE_KEY || undefined) as Hex | undefined,
  });
  globalForBlockchain.__veriClient = client;
  return client;
}

/** Project 3: lazily-created TransitionRegistryClient singleton for EIP-712
 *  signed claim state transitions. Requires TRANSITION_REGISTRY_ADDRESS,
 *  BSC_RPC_URL, and WALLET_PRIVATE_KEY (the EIP-712 authority). */
export function getTransitionClient(): TransitionRegistryClient {
  if (globalForBlockchain.__transitionClient) return globalForBlockchain.__transitionClient;
  const rpcUrl = process.env.BSC_RPC_URL;
  const transitionAddress = process.env.TRANSITION_REGISTRY_ADDRESS;
  if (!rpcUrl || !transitionAddress) {
    throw new Error(
      "TransitionRegistry not configured — set BSC_RPC_URL and TRANSITION_REGISTRY_ADDRESS in .env",
    );
  }
  const client = new TransitionRegistryClient({
    rpcUrl,
    chain: resolveChain(process.env.BSC_NETWORK),
    transitionAddress: transitionAddress as Hex,
    privateKey: (process.env.WALLET_PRIVATE_KEY || undefined) as Hex | undefined,
  });
  globalForBlockchain.__transitionClient = client;
  return client;
}
