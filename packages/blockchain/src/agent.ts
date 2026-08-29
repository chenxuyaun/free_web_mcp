/** ERC-8004 Trustless Agents client (spec §28, Phase A).
 *
 * Interacts with the OFFICIALLY DEPLOYED registries on BSC Testnet —
 * no contract deployment needed:
 *   Identity Registry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   Reputation Registry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 * (see github.com/erc-8004/erc-8004-contracts — same vanity addresses on 50 chains)
 *
 * v1 scope: register the agent (mint agentId) + read back ownership/URI.
 * Reputation feedback writing is deferred (contract blocks self-feedback;
 * needs a second non-owner wallet).
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Chain,
  type Hex,
} from "viem";
import { rpcHttp } from "./chains";

export const ERC8004_IDENTITY_ADDRESS_TESTNET: Hex =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const ERC8004_REPUTATION_ADDRESS_TESTNET: Hex =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713";

export const ERC8004_IDENTITY_ABI = [
  {
    inputs: [
      { internalType: "string", name: "agentURI", type: "string" },
      {
        components: [
          { internalType: "string", name: "key", type: "string" },
          { internalType: "bytes", name: "value", type: "bytes" },
        ],
        internalType: "struct ERC8004IdentityRegistry.MetadataEntry[]",
        name: "metadata",
        type: "tuple[]",
      },
    ],
    name: "register",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      { indexed: true, internalType: "uint256", name: "tokenId", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

export const ERC8004_REPUTATION_ABI = [
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "int128", name: "value", type: "int128" },
      { internalType: "uint8", name: "valueDecimals", type: "uint8" },
      { internalType: "string", name: "tag1", type: "string" },
      { internalType: "string", name: "tag2", type: "string" },
      { internalType: "string", name: "endpoint", type: "string" },
      { internalType: "string", name: "feedbackURI", type: "string" },
      { internalType: "bytes32", name: "feedbackHash", type: "bytes32" },
    ],
    name: "giveFeedback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address[]", name: "clientAddresses", type: "address[]" },
      { internalType: "string", name: "tag1", type: "string" },
      { internalType: "string", name: "tag2", type: "string" },
    ],
    name: "getSummary",
    outputs: [
      { internalType: "uint64", name: "", type: "uint64" },
      { internalType: "int128", name: "", type: "int128" },
      { internalType: "uint8", name: "", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface ReputationConfig {
  rpcUrl: string;
  chain: Chain;
  reputationAddress: Hex;
  /** Second wallet — the registry blocks agents from feedbacking themselves. */
  feedbackPrivateKey?: Hex;
}

export interface FeedbackInput {
  agentId: bigint;
  /** 0..100 scale encoded as int128 with 0 decimals. */
  value: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI: string;
  feedbackHash: Hex;
}

export interface ReputationSummary {
  count: bigint;
  overallValue: bigint;
  valueDecimals: number;
}

export class ReputationClient {
  private cfg: ReputationConfig;
  readonly reputationAddress: Hex;

  constructor(cfg: ReputationConfig) {
    this.cfg = cfg;
    this.reputationAddress = cfg.reputationAddress;
  }

  /** Post client feedback for an agent (must NOT be signed by the agent owner). */
  async giveFeedback(input: FeedbackInput): Promise<Hex> {
    if (!this.cfg.feedbackPrivateKey) {
      throw new Error("No feedback signer configured (FEEDBACK_PRIVATE_KEY).");
    }
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(this.cfg.feedbackPrivateKey);
    const wc = createWalletClient({
      account,
      chain: this.cfg.chain,
      transport: rpcHttp(this.cfg.rpcUrl),
    });
    const txHash = await wc.writeContract({
      address: this.reputationAddress,
      abi: ERC8004_REPUTATION_ABI,
      functionName: "giveFeedback",
      args: [
        input.agentId,
        BigInt(input.value),
        0, // valueDecimals
        input.tag1 ?? "evidence-verification",
        input.tag2 ?? "web",
        input.endpoint ?? "",
        input.feedbackURI,
        input.feedbackHash,
      ],
      account,
      chain: this.cfg.chain,
    });
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    await pc.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  }

  /** Aggregate reputation for an agent across the given client wallets. */
  async getSummary(
    agentId: bigint,
    clientAddresses: Hex[],
    tag1 = "",
    tag2 = "",
  ): Promise<ReputationSummary> {
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    const [count, value, decimals] = await pc.readContract({
      address: this.reputationAddress,
      abi: ERC8004_REPUTATION_ABI,
      functionName: "getSummary",
      args: [agentId, clientAddresses, tag1, tag2],
    });
    return { count, overallValue: value, valueDecimals: decimals };
  }
}

export interface AgentIdentityConfig {
  rpcUrl: string;
  chain: Chain;
  identityAddress: Hex;
  privateKey?: Hex;
  explorerUrl?: string;
}

export interface RegisterResult {
  agentId: bigint;
  txHash: Hex;
  agentURI: string;
  owner: Hex;
}

export class AgentIdentityClient {
  private cfg: AgentIdentityConfig;
  readonly identityAddress: Hex;

  constructor(cfg: AgentIdentityConfig) {
    this.cfg = cfg;
    this.identityAddress = cfg.identityAddress;
  }

  async hasRegistry(): Promise<boolean> {
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    const code = await pc.getCode({ address: this.identityAddress });
    return code !== undefined && code !== "0x" && code.length > 2;
  }

  /** Mint the agent identity; returns the agentId parsed from the Transfer event. */
  async register(agentURI: string): Promise<RegisterResult> {
    if (!this.cfg.privateKey) throw new Error("No signer configured (WALLET_PRIVATE_KEY).");
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(this.cfg.privateKey);
    const wc = createWalletClient({ account, chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });

    const txHash = await wc.writeContract({
      address: this.identityAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "register",
      args: [agentURI, []],
      account,
      chain: this.cfg.chain,
    });
    const receipt = await pc.waitForTransactionReceipt({ hash: txHash });

    // agentId = tokenId from the ERC-721 Transfer event minted by the registry
    let agentId = 0n;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: ERC8004_IDENTITY_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer") {
          const args = decoded.args as { tokenId?: bigint; to?: Hex };
          if (args.tokenId !== undefined) agentId = args.tokenId;
        }
      } catch {
        // not our event — skip
      }
    }
    if (agentId === 0n) throw new Error("register succeeded but no Transfer event found");

    return {
      agentId,
      txHash,
      agentURI,
      owner: account.address,
    };
  }

  async ownerOf(agentId: bigint): Promise<Hex> {
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    return pc.readContract({
      address: this.identityAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    });
  }

  async tokenURI(agentId: bigint): Promise<string> {
    const pc = createPublicClient({ chain: this.cfg.chain, transport: rpcHttp(this.cfg.rpcUrl) });
    return pc.readContract({
      address: this.identityAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    });
  }

  txUrl(txHash: Hex): string | null {
    if (!this.cfg.explorerUrl) return null;
    return `${this.cfg.explorerUrl}/tx/${txHash}`;
  }
}
