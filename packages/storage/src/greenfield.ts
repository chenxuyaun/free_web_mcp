/** BNB Greenfield publisher for evidence packages (spec §27).
 *
 * Content-addressed: objectName = sha256(canonical JSON) → objects are
 * immutable and verifiable. One-time idempotent bucket setup; per-package
 * createObject tx + HTTP PUT (Reed-Solomon checksums) + sealed polling.
 *
 * Auth: ECDSA private-key mode (server-side / Node) per SDK docs.
 * URI returned: https://<sp-endpoint>/view/<bucket>/<objectName> (public-read,
 * no signature needed to fetch).
 */

import { Client, VisibilityType, RedundancyType, Long, bytesFromBase64 } from "@bnb-chain/greenfield-js-sdk";
import { NodeAdapterReedSolomon } from "@bnb-chain/reed-solomon/node.adapter";
import { createHash } from "node:crypto";

export interface GreenfieldConfig {
  rpcUrl: string;
  chainId: string; // EVM numeric id as string, e.g. "5600"
  bucket: string;
  privateKey: `0x${string}`;
  /** SP endpoint used to build the public view URL, e.g. https://gnfd-testnet-sp1.bnbchain.org */
  spEndpoint: string;
  /** Account address derived from privateKey (set once at construction). */
  accountAddress: `0x${string}`;
}

export interface PublishResult {
  uri: string;
  objectName: string;
  txHash: string;
  contentHash: string; // sha256 hex of the uploaded bytes
  size: number;
}

export const DEFAULT_GREENFIELD_CONFIG = {
  rpcUrl: "https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org",
  chainId: "5600",
  spEndpoint: "https://gnfd-testnet-sp1.bnbchain.org",
} as const;

export class GreenfieldPublisher {
  private client: ReturnType<typeof Client.create>;
  private cfg: GreenfieldConfig;
  private bucketReady = false;

  constructor(cfg: GreenfieldConfig) {
    this.cfg = cfg;
    this.client = Client.create(cfg.rpcUrl, cfg.chainId);
  }

  contentHashOf(json: string): string {
    return createHash("sha256").update(json, "utf8").digest("hex");
  }

  viewUrl(objectName: string): string {
    return `${this.cfg.spEndpoint}/view/${this.cfg.bucket}/${objectName}`;
  }

  /** One-time, idempotent bucket creation (public-read, owner pays). */
  async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const addr = this.cfg.accountAddress;

    // headBucket: if it exists on-chain we're done.
    try {
      const head = await this.client.bucket.headBucket(this.cfg.bucket);
      if (head && (head as { bucketInfo?: unknown }).bucketInfo) {
        this.bucketReady = true;
        return;
      }
    } catch {
      // not found → create below
    }

    const sps = await this.client.sp.getStorageProviders();
    if (!sps?.length) throw new Error("No Greenfield storage providers found.");
    const primarySp = sps[0];

    const tx = await this.client.bucket.createBucket({
      bucketName: this.cfg.bucket,
      creator: addr,
      visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
      chargedReadQuota: Long.fromString("0"),
      primarySpAddress: primarySp.operatorAddress,
      paymentAddress: addr,
    });
    const simulate = await tx.simulate({ denom: "BNB" });
    await tx.broadcast({
      denom: "BNB",
      gasLimit: Number(simulate.gasLimit),
      gasPrice: simulate.gasPrice || "5000000000",
      payer: addr,
      granter: "",
      privateKey: this.cfg.privateKey,
    });
    this.bucketReady = true;
  }

  /** Upload a JSON string as a content-addressed object; returns public view URI. */
  async publish(json: string): Promise<PublishResult> {
    await this.ensureBucket();

    const contentHash = this.contentHashOf(json);
    const objectName = `${contentHash}.json`;
    const buf = Buffer.from(json, "utf8");
    const addr = this.cfg.accountAddress;

    const checksums = await new NodeAdapterReedSolomon().encodeInWorker(
      __filename,
      Uint8Array.from(buf),
    );

    const tx = await this.client.object.createObject({
      bucketName: this.cfg.bucket,
      objectName,
      creator: addr,
      visibility: VisibilityType.VISIBILITY_TYPE_PUBLIC_READ,
      contentType: "application/json",
      redundancyType: RedundancyType.REDUNDANCY_EC_TYPE,
      payloadSize: Long.fromInt(buf.length),
      expectChecksums: checksums.map(bytesFromBase64),
    });
    const simulate = await tx.simulate({ denom: "BNB" });
    const res = await tx.broadcast({
      denom: "BNB",
      gasLimit: Number(simulate.gasLimit),
      gasPrice: simulate.gasPrice || "5000000000",
      payer: addr,
      granter: "",
      privateKey: this.cfg.privateKey,
    });

    await this.client.object.uploadObject(
      {
        bucketName: this.cfg.bucket,
        objectName,
        body: { name: objectName, type: "application/json", size: buf.length, content: buf },
        txnHash: res.transactionHash,
      },
      { type: "ECDSA", privateKey: this.cfg.privateKey },
    );

    await this.waitSealed(objectName);

    return {
      uri: this.viewUrl(objectName),
      objectName,
      txHash: res.transactionHash,
      contentHash,
      size: buf.length,
    };
  }

  /** Poll headObject until the SP seals the object (or timeout). */
  async waitSealed(objectName: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const head = (await this.client.object.headObject(this.cfg.bucket, objectName)) as {
          objectInfo?: { objectStatus?: string | number };
        };
        const status = head?.objectInfo?.objectStatus;
        // ObjectStatus.OBJECT_STATUS_SEALED === 2 per Greenfield types
        if (status === 2 || status === "OBJECT_STATUS_SEALED") return;
      } catch {
        // not visible yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Greenfield object ${objectName} not sealed within ${timeoutMs}ms`);
  }

  /** Verify a published object is retrievable (public GET, no auth). */
  async isRetrievable(uri: string): Promise<boolean> {
    try {
      const r = await fetch(uri, { signal: AbortSignal.timeout(10_000) });
      return r.ok;
    } catch {
      return false;
    }
  }
}
