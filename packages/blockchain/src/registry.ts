import {
  createPublicClient,
  createWalletClient,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EVIDENCE_REGISTERED_EVENT, EVIDENCE_REGISTRY_ABI, rpcHttp } from "./chains";

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
      transport: rpcHttp(opts.rpcUrl),
    });
    this.registryAddress = opts.registryAddress;
    this.chain = opts.chain;
    this.explorerUrl = opts.explorerUrl;

    if (opts.privateKey) {
      const account = privateKeyToAccount(opts.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain: opts.chain,
        transport: rpcHttp(opts.rpcUrl),
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

  /** Read recent EvidenceRegistered events (M1C: on-chain anchor feed).
   *  Public BSC RPCs cap getLogs ranges, so we scan backwards in
   *  CHUNK-sized windows until we have enough records or hit the chunk budget. */
  async listAnchoredRecords(opts: ListRecordsOptions = {}): Promise<AnchoredRecord[]> {
    const CHUNK = 1_000n;
    const MAX_CHUNKS = 50; // ~50k blocks of history
    const limit = opts.limit ?? 10;

    const toBlock = await this.publicClient.getBlockNumber();
    const floor = opts.fromBlock ?? 0n;
    const found: AnchoredRecord[] = [];

    let hi = toBlock;
    for (let i = 0; i < MAX_CHUNKS && hi >= floor && found.length < limit; i++) {
      const lo = hi - CHUNK + 1n > floor ? hi - CHUNK + 1n : floor;
      const logs = await this.publicClient.getLogs({
        address: this.registryAddress,
        event: EVIDENCE_REGISTERED_EVENT,
        fromBlock: lo,
        toBlock: hi,
      });
      for (const log of logs) {
        found.push({
          evidenceHash: log.args.evidenceHash ?? "",
          uri: log.args.uri ?? "",
          timestamp: log.args.timestamp ?? 0n,
          submitter: log.args.submitter ?? "",
          version: log.args.version ?? "",
          txHash: log.transactionHash ?? "",
          blockNumber: log.blockNumber,
        });
        if (found.length >= limit) break;
      }
      hi = lo - 1n;
    }
    return found;
  }
}

export interface AnchoredRecord {
  evidenceHash: string;
  uri: string;
  timestamp: bigint;
  submitter: string;
  version: string;
  txHash: string;
  blockNumber: bigint;
}

export interface ListRecordsOptions {
  /** Block to scan from. Defaults to the last 10,000 blocks. */
  fromBlock?: bigint;
  limit?: number;
}
