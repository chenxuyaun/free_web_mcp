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
  http,
  type Chain,
  type Hex,
} from "viem";

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
    const pc = createPublicClient({ chain: this.cfg.chain, transport: http(this.cfg.rpcUrl) });
    const code = await pc.getCode({ address: this.identityAddress });
    return code !== undefined && code !== "0x" && code.length > 2;
  }

  /** Mint the agent identity; returns the agentId parsed from the Transfer event. */
  async register(agentURI: string): Promise<RegisterResult> {
    if (!this.cfg.privateKey) throw new Error("No signer configured (WALLET_PRIVATE_KEY).");
    const pc = createPublicClient({ chain: this.cfg.chain, transport: http(this.cfg.rpcUrl) });
    const { privateKeyToAccount } = await import("viem/accounts");
    const account = privateKeyToAccount(this.cfg.privateKey);
    const wc = createWalletClient({ account, chain: this.cfg.chain, transport: http(this.cfg.rpcUrl) });

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
    const pc = createPublicClient({ chain: this.cfg.chain, transport: http(this.cfg.rpcUrl) });
    return pc.readContract({
      address: this.identityAddress,
      abi: ERC8004_IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    });
  }

  async tokenURI(agentId: bigint): Promise<string> {
    const pc = createPublicClient({ chain: this.cfg.chain, transport: http(this.cfg.rpcUrl) });
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
