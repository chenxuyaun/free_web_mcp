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
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

type NodeAdapterReedSolomonCtor = new () => {
  encodeInSubWorker(data: Uint8Array): Promise<string[]>;
};

/** Load the Reed-Solomon node adapter at runtime (webpackIgnore) because its
 *  worker_threads sibling file cannot survive bundling. */
async function loadReedSolomon(): Promise<NodeAdapterReedSolomonCtor> {
  const adapterPath = process.env.REED_SOLOMON_ADAPTER;
  if (adapterPath) {
    const mod = (await import(/* webpackIgnore: true */ pathToFileURL(adapterPath).href)) as {
      NodeAdapterReedSolomon: NodeAdapterReedSolomonCtor;
    };
    return mod.NodeAdapterReedSolomon;
  }
  // Non-bundled runtime (tests/CLI): plain import resolves normally.
  const mod = (await import("@bnb-chain/reed-solomon/node.adapter")) as unknown as {
    NodeAdapterReedSolomon: NodeAdapterReedSolomonCtor;
  };
  return mod.NodeAdapterReedSolomon;
}

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

  /** Pick the first SP whose gateway is reachable from this machine.
   *  PUT writes must go to the bucket's primary SP — if we create the bucket
   *  on an unreachable SP the payload upload can never succeed. */
  async pickReachableSp(
    sps: Array<{ operatorAddress?: string; endpoint?: string }>,
  ): Promise<{ operatorAddress: string; endpoint: string }> {
    for (const sp of sps) {
      if (!sp.endpoint || !sp.operatorAddress) continue;
      try {
        await fetch(sp.endpoint, { signal: AbortSignal.timeout(8000) });
        // Any HTTP response (even 4xx/5xx) means the gateway is reachable.
        return { operatorAddress: sp.operatorAddress, endpoint: sp.endpoint };
      } catch {
        continue;
      }
    }
    throw new Error(
      "No reachable Greenfield storage provider gateway — check network/VPN and retry.",
    );
  }

  /** One-time, idempotent bucket creation (public-read, owner pays).
   *  Primary SP is chosen by gateway reachability, not list order. */
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
    const primarySp = await this.pickReachableSp(sps);

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

    // encodeInWorker(p, data) is deprecated (requires a worker script path);
    // encodeInSubWorker bundles its own worker entry.
    const RS = await loadReedSolomon();
    const checksums = await new RS().encodeInSubWorker(Uint8Array.from(buf));

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

    // uploadObject/putObject do NOT throw on HTTP failure — they return
    // {code, message, statusCode}. Surface failures loudly.
    const upRes = (await this.client.object.uploadObject(
      {
        bucketName: this.cfg.bucket,
        objectName,
        body: { name: objectName, type: "application/json", size: buf.length, content: buf },
        txnHash: res.transactionHash,
      },
      { type: "ECDSA", privateKey: this.cfg.privateKey },
    )) as { code?: number; message?: string; statusCode?: number } | undefined;

    if (upRes && typeof upRes === "object" && "code" in upRes && upRes.code !== 0) {
      throw new Error(
        `Greenfield payload upload failed: ${upRes.message} (code ${upRes.code}, status ${upRes.statusCode})`,
      );
    }

    await this.waitSealed(objectName);

    const uri = await this.resolveViewUrl(objectName);

    return {
      uri,
      objectName,
      txHash: res.transactionHash,
      contentHash,
      size: buf.length,
    };
  }

  /** Poll headObject until the SP seals the object (or timeout).
   *  Greenfield ObjectStatus: 0 = CREATED, 1 = SEALED. */
  async waitSealed(objectName: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const head = (await this.client.object.headObject(this.cfg.bucket, objectName)) as {
          objectInfo?: { objectStatus?: string | number };
        };
        const status = Number(head?.objectInfo?.objectStatus ?? 0);
        if (status === 1) return;
      } catch {
        // not visible yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`Greenfield object ${objectName} not sealed within ${timeoutMs}ms`);
  }

  /** Resolve the bucket's primary SP public endpoint and rebuild the view URL. */
  async resolveViewUrl(objectName: string): Promise<string> {
    try {
      const head = (await this.client.bucket.headBucket(this.cfg.bucket)) as {
        bucketInfo?: { primarySpAddress?: string };
      };
      const spAddr = head?.bucketInfo?.primarySpAddress;
      if (spAddr) {
        const sps = await this.client.sp.getStorageProviders();
        const sp = sps.find((s: { operatorAddress?: string }) => s.operatorAddress === spAddr);
        if (sp?.endpoint) return `${sp.endpoint}/view/${this.cfg.bucket}/${objectName}`;
      }
    } catch {
      // fall through to configured endpoint
    }
    return this.viewUrl(objectName);
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
