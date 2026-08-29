import "server-only";

import {
  AgentIdentityClient,
  ERC8004_IDENTITY_ADDRESS_TESTNET,
  ERC8004_REPUTATION_ADDRESS_TESTNET,
  ReputationClient,
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
export function getReputationClient(): ReputationClient {
  const reg = getRegistryConfig();
  return new ReputationClient({
    rpcUrl: reg.rpcUrl,
    chain: reg.chain,
    reputationAddress:
      (process.env.ERC8004_REPUTATION_ADDRESS as Hex | undefined) ??
      ERC8004_REPUTATION_ADDRESS_TESTNET,
    feedbackPrivateKey: (process.env.FEEDBACK_PRIVATE_KEY as Hex | undefined) ?? undefined,
  });
}

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

/** Live on-chain reputation summary for the registered agent (null when N/A). */
export async function getReputationSummary(): Promise<{
  count: string;
  overallValue: string;
  valueDecimals: number;
} | null> {
  const reg = getRegisteredAgent();
  if (!reg) return null;
  try {
    const rep = getReputationClient();
    const client = (process.env.FEEDBACK_ADDRESS as Hex | undefined) ?? undefined;
    const summary = await rep.getSummary(BigInt(reg.agentId), client ? [client] : []);
    return {
      count: summary.count.toString(),
      overallValue: summary.overallValue.toString(),
      valueDecimals: summary.valueDecimals,
    };
  } catch {
    return null;
  }
}
