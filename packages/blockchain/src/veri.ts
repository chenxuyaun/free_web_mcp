/** V26 VERI token client — mint on-chain VERI rewards.
 *
 *  VERI is the native incentive token (ERC-20) for the Free Web MCP
 *  evidence-validation network. The server-side signer (contract owner)
 *  mints VERI as a reward for correct attestation/challenge judgments.
 *
 *  Design follows EvidenceRegistryClient: lazy rpcHttp transport, no retry,
 *  singleton via apps/web/lib/blockchain.ts. */

import {
  createPublicClient,
  createWalletClient,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { rpcHttp } from "./chains";

// ---------------------------------------------------------------------------
// ABI
// ---------------------------------------------------------------------------

export const VERI_ABI = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "mint",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ---------------------------------------------------------------------------
// Options & result types
// ---------------------------------------------------------------------------

export interface VeriClientOptions {
  rpcUrl: string;
  chain: Chain;
  veriAddress: Hex;
  privateKey?: Hex;
}

export interface MintResult {
  txHash: Hex;
  blockNumber: bigint;
  network: string;
  contractAddress: Hex;
}

// ---------------------------------------------------------------------------
// VeriClient
// ---------------------------------------------------------------------------

export class VeriClient {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  readonly veriAddress: Hex;
  readonly chain: Chain;

  constructor(opts: VeriClientOptions) {
    this.publicClient = createPublicClient({
      chain: opts.chain,
      transport: rpcHttp(opts.rpcUrl),
    });
    this.veriAddress = opts.veriAddress;
    this.chain = opts.chain;

    if (opts.privateKey) {
      const account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain: opts.chain,
        transport: rpcHttp(opts.rpcUrl),
      });
    }
  }

  /** Mint `amount` wei of VERI to `to`. The signer must be the contract
   *  owner (onlyOwner). Returns the tx hash + block. */
  async mint(to: Hex, amount: bigint): Promise<MintResult> {
    if (!this.walletClient) {
      throw new Error("No signer configured — WALLET_PRIVATE_KEY is missing.");
    }
    const account = this.walletClient.account!;
    const txHash = await this.walletClient.writeContract({
      address: this.veriAddress,
      abi: VERI_ABI,
      functionName: "mint",
      args: [to, amount],
      account,
      chain: this.chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      txHash,
      blockNumber: receipt.blockNumber,
      network: this.chain.name,
      contractAddress: this.veriAddress,
    };
  }

  /** Read the VERI balance of an address. */
  async balanceOf(address: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.veriAddress,
      abi: VERI_ABI,
      functionName: "balanceOf",
      args: [address],
    });
  }
}