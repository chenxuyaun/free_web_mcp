import "server-only";

import {
  AgentIdentityClient,
  ERC8004_IDENTITY_ADDRESS_TESTNET,
} from "@free-web-mcp/blockchain";
import type { Hex } from "viem";
import { getRegistryConfig } from "@/lib/blockchain";
import { getMeta, setMeta } from "@/lib/db";

export interface AgentRegistration {
  agentId: string;
  txHash: string;
  agentURI: string;
  identityAddress: Hex;
}

/** ERC-8004 client reusing the BSC chain settings (RPC/chain/key/explorer). */
export function getAgentClient(): AgentIdentityClient {
  const reg = getRegistryConfig();
  return new AgentIdentityClient({
    rpcUrl: reg.rpcUrl,
    chain: reg.chain,
    identityAddress:
      (process.env.ERC8004_IDENTITY_ADDRESS as Hex | undefined) ??
      ERC8004_IDENTITY_ADDRESS_TESTNET,
    privateKey: reg.privateKey,
    explorerUrl: reg.explorerUrl,
  });
}

export const AGENT_META_KEY = "erc8004_agent";

export function getRegisteredAgent(): AgentRegistration | null {
  const raw = getMeta(AGENT_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentRegistration;
  } catch {
    return null;
  }
}

export function saveRegisteredAgent(reg: AgentRegistration): void {
  setMeta(AGENT_META_KEY, JSON.stringify(reg));
}
