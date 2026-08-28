import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EVIDENCE_REGISTRY_ABI } from "./chains";

export interface AnchorResult {
  txHash: Hex;
  blockNumber: bigint;
  network: string;
  contractAddress: Hex;
}

export interface RegistryClientOptions {
  rpcUrl: string;
  chain: Chain;
  registryAddress: Hex;
  /** Wallet private key (server-side signer only — NEVER in frontend/logs). */
  privateKey?: Hex;
  explorerUrl?: string;
}

export class EvidenceRegistryClient {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  readonly registryAddress: Hex;
  readonly chain: Chain;
  readonly explorerUrl?: string;

  constructor(opts: RegistryClientOptions) {
    this.publicClient = createPublicClient({
      chain: opts.chain,
      transport: http(opts.rpcUrl),
    });
    this.registryAddress = opts.registryAddress;
    this.chain = opts.chain;
    this.explorerUrl = opts.explorerUrl;

    if (opts.privateKey) {
      const account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain: opts.chain,
        transport: http(opts.rpcUrl),
      });
    }
  }

  async getChainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  /** True if a contract is deployed at the registry address. */
  async hasContract(): Promise<boolean> {
    const code = await this.publicClient.getCode({ address: this.registryAddress });
    return code !== undefined && code !== "0x" && code.length > 2;
  }

  async exists(hash: Hex): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: EVIDENCE_REGISTRY_ABI,
      functionName: "exists",
      args: [hash],
    });
  }

  /** Register an evidence hash on-chain (spec §16/§18). Requires a signer. */
  async anchorEvidence(hash: Hex, uri: string, version: string): Promise<AnchorResult> {
    if (!this.walletClient) {
      throw new Error("No signer configured — WALLET_PRIVATE_KEY is missing.");
    }
    const account = this.walletClient.account!;
    const txHash = await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: EVIDENCE_REGISTRY_ABI,
      functionName: "registerEvidence",
      args: [hash, uri, version],
      account,
      chain: this.chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      txHash,
      blockNumber: receipt.blockNumber,
      network: this.chain.name,
      contractAddress: this.registryAddress,
    };
  }

  async getRecord(hash: Hex) {
    return this.publicClient.readContract({
      address: this.registryAddress,
      abi: EVIDENCE_REGISTRY_ABI,
      functionName: "getEvidence",
      args: [hash],
    });
  }

  txUrl(txHash: Hex): string | null {
    if (!this.explorerUrl) return null;
    return `${this.explorerUrl}/tx/${txHash}`;
  }
}
