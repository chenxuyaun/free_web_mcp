/** TransitionRegistryClient — EIP-712 signed claim state-transition log
 *  (project 3).
 *
 *  The TransitionRegistry records intermediate claim lifecycle steps
 *  (OBSERVED → SUPPORTED → CHALLENGED → DISPUTED → RESOLVED/EXPIRED) as
 *  cheap, replay-safe on-chain events. The server signs each transition
 *  with EIP-712 typed data (viem signTypedData); anyone can relay the
 *  signed message (the signer, not the tx sender, is verified on-chain). */

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
import { TRANSITION_REGISTRY_ABI, CLAIM_STATE_ENUM } from "./chains";

// ---------------------------------------------------------------------------
// Options & result types
// ---------------------------------------------------------------------------

export interface TransitionRegistryClientOptions {
  rpcUrl: string;
  chain: Chain;
  transitionAddress: Hex;
  /** Server signer private key (EIP-712 authority). NEVER in frontend/logs. */
  privateKey?: Hex;
}

export interface TransitionAnchorResult {
  txHash: Hex;
  blockNumber: bigint;
  network: string;
  contractAddress: Hex;
}

// ---------------------------------------------------------------------------
// EIP-712 typed data (must mirror TransitionRegistry.sol)
// ---------------------------------------------------------------------------

const TRANSITION_TYPES = {
  ClaimTransition: [
    { name: "claimHash", type: "bytes32" },
    { name: "fromState", type: "uint8" },
    { name: "toState", type: "uint8" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

// ---------------------------------------------------------------------------
// TransitionRegistryClient
// ---------------------------------------------------------------------------

export class TransitionRegistryClient {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  /** LocalAccount with signTypedData (narrower than WalletClient.account). */
  private signerAccount?: ReturnType<typeof privateKeyToAccount>;
  readonly transitionAddress: Hex;
  readonly chain: Chain;

  constructor(opts: TransitionRegistryClientOptions) {
    this.publicClient = createPublicClient({
      chain: opts.chain,
      transport: rpcHttp(opts.rpcUrl),
    });
    this.transitionAddress = opts.transitionAddress;
    this.chain = opts.chain;

    if (opts.privateKey) {
      const account = privateKeyToAccount(opts.privateKey);
      this.signerAccount = account;
      this.walletClient = createWalletClient({
        account,
        chain: opts.chain,
        transport: rpcHttp(opts.rpcUrl),
      });
    }
  }

  /** The on-chain EIP-712 domain separator. */
  async domainSeparator(): Promise<Hex> {
    return this.publicClient.readContract({
      address: this.transitionAddress,
      abi: TRANSITION_REGISTRY_ABI,
      functionName: "domainSeparator",
    });
  }

  /** Next nonce that must be signed for a claim (replay guard). */
  async nonceOf(claimHash: Hex): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.transitionAddress,
      abi: TRANSITION_REGISTRY_ABI,
      functionName: "nonceOf",
      args: [claimHash],
    });
  }

  /** The latest recorded transition for a claim. */
  async getTransition(claimHash: Hex): Promise<{
    claimHash: Hex;
    fromState: number;
    toState: number;
    timestamp: bigint;
    nonce: bigint;
    signer: Hex;
    exists: boolean;
  }> {
    return this.publicClient.readContract({
      address: this.transitionAddress,
      abi: TRANSITION_REGISTRY_ABI,
      functionName: "getTransition",
      args: [claimHash],
    });
  }

  /** Map a ClaimState string to its uint8 enum value (mirrors
   *  TransitionRegistry: DRAFT=0, OBSERVED=1, SUPPORTED=2, CHALLENGED=3,
   *  DISPUTED=4, RESOLVED=5, FINAL=6, EXPIRED=7). */
  static stateNumber(state: string): number {
    const n = CLAIM_STATE_ENUM[state];
    if (n === undefined) throw new Error(`Unknown claim state: ${state}`);
    return n;
  }

  /** Sign + record a claim state transition on-chain (project 3).
   *  Reads the current nonce, signs the EIP-712 typed data with the server
   *  key, and relays `recordTransition`. Requires a signer. */
  async recordTransition(
    claimHash: Hex,
    fromState: string,
    toState: string,
  ): Promise<TransitionAnchorResult> {
    if (!this.walletClient || !this.signerAccount) {
      throw new Error("No signer configured — WALLET_PRIVATE_KEY is missing.");
    }
    const account = this.signerAccount;
    const nonce = await this.nonceOf(claimHash);

    const domain = {
      name: "FreeWebMCP",
      version: "1",
      chainId: this.chain.id,
      verifyingContract: this.transitionAddress,
    } as const;

    const typedData = {
      domain,
      types: TRANSITION_TYPES,
      primaryType: "ClaimTransition" as const,
      message: {
        claimHash,
        fromState: TransitionRegistryClient.stateNumber(fromState),
        toState: TransitionRegistryClient.stateNumber(toState),
        nonce,
      },
    };

    const signature = await account.signTypedData(typedData);

    const txHash = await this.walletClient.writeContract({
      address: this.transitionAddress,
      abi: TRANSITION_REGISTRY_ABI,
      functionName: "recordTransition",
      args: [
        claimHash,
        TransitionRegistryClient.stateNumber(fromState),
        TransitionRegistryClient.stateNumber(toState),
        signature,
      ],
      account,
      chain: this.chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      txHash,
      blockNumber: receipt.blockNumber,
      network: this.chain.name,
      contractAddress: this.transitionAddress,
    };
  }
}
