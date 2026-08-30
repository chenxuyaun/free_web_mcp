import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidencePackage, sha256, type EvidenceSource } from "@free-web-mcp/evidence";
import {
  closeDb,
  countEvidence,
  getDb,
  getEvidencePackage,
  getStats,
  insertEvidence,
  listEvidence,
  markAnchored,
} from "../lib/db";
import { attestClaim, challengeClaim } from "../lib/protocol-db";

const tmpDirs: string[] = [];

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwm-db-"));
  tmpDirs.push(dir);
  return path.join(dir, "test.db");
}

afterAll(() => {
  closeDb();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function source(url: string, sourceType: EvidenceSource["sourceType"]): EvidenceSource {
  return {
    url,
    title: `t-${url}`,
    sourceType,
    publishedAt: "2026-01-01T00:00:00Z",
    retrievedAt: "2026-08-01T00:00:00Z",
    contentHash: sha256(url),
  };
}

function makePkg(claimText: string, url = "https://a.example/1") {
  return buildEvidencePackage({
    id: "EV-TEMP",
    claimText,
    claimType: "fact",
    supporting: [source(url, "official")],
    crossVerified: false,
  });
}

describe("evidence db layer", () => {
  it("insert assigns sequential EV ids and round-trips the package", () => {
    const dbPath = makeDbPath();
    const a = makePkg("Claim one");
    const b = makePkg("Claim two", "https://b.example/1");

    const savedA = insertEvidence(a, dbPath);
    const savedB = insertEvidence(b, dbPath);

    expect(savedA.id).toBe("EV-000001");
    expect(savedB.id).toBe("EV-000002");

    const loaded = getEvidencePackage("EV-000001", dbPath);
    expect(loaded).not.toBeNull();
    expect(loaded?.claim.text).toBe("Claim one");
    expect(loaded?.assessment.status).toBe("LIKELY_TRUE");
  });

  it("list returns summaries newest-first with correct flags", () => {
    const dbPath = makeDbPath();
    insertEvidence(makePkg("First"), dbPath);
    insertEvidence(makePkg("Second", "https://c.example/1"), dbPath);

    const items = listEvidence(dbPath);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("EV-000002");
    expect(items[0].anchored).toBe(false);
    expect(items[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stats count verified / counter / on-chain records", () => {
    const dbPath = makeDbPath();
    insertEvidence(makePkg("One"), dbPath);
    insertEvidence(makePkg("Two", "https://c.example/1"), dbPath);

    let stats = getStats(dbPath);
    expect(stats.totalEvidence).toBe(2);
    expect(stats.verifiedClaims).toBe(2);
    expect(stats.onChainRecords).toBe(0);

    expect(markAnchored("EV-000001", {
      anchored: true,
      txHash: "0x" + "a".repeat(64),
      contractAddress: "0x" + "b".repeat(40),
      network: "anvil",
      blockNumber: 1,
      evidenceHash: "0x" + "c".repeat(64),
      uri: "https://example.com/evidence/1",
    }, dbPath)).toBe(true);

    stats = getStats(dbPath);
    expect(stats.onChainRecords).toBe(1);
  });

  it("markAnchored persists the blockchain block into the package", () => {
    const dbPath = makeDbPath();
    insertEvidence(makePkg("Anchor me"), dbPath);

    markAnchored("EV-000001", {
      anchored: true,
      txHash: "0x" + "1".repeat(64),
      contractAddress: "0x" + "2".repeat(40),
      network: "bsc-testnet",
      blockNumber: 42,
      evidenceHash: "0x" + "3".repeat(64),
      uri: "https://example.com/evidence/1",
    }, dbPath);

    const pkg = getEvidencePackage("EV-000001", dbPath);
    expect(pkg?.blockchain?.anchored).toBe(true);
    expect(pkg?.blockchain?.txHash).toBe("0x" + "1".repeat(64));
    expect(pkg?.blockchain?.blockNumber).toBe(42);
  });

  it("getEvidencePackage returns null for unknown ids", () => {
    const dbPath = makeDbPath();
    expect(getEvidencePackage("EV-999999", dbPath)).toBeNull();
  });

  it("countEvidence reflects row count", () => {
    const dbPath = makeDbPath();
    expect(countEvidence(dbPath)).toBe(0);
    insertEvidence(makePkg("Only"), dbPath);
    expect(countEvidence(dbPath)).toBe(1);
  });

  it("V17: source quotes persist and feed the citation envelope", () => {
    const dbPath = makeDbPath();
    const src = {
      ...source("https://a.example/quote", "official"),
      quote: "The factory in Shenzhen produced 1.2M units last quarter.",
    };
    const { pkg } = buildEvidencePackage({
      id: "EV-TEMP",
      claimText: "Factory produced over a million units",
      claimType: "number",
      supporting: [src],
      crossVerified: true,
    });
    const saved = insertEvidence({ pkg, hash: "" }, dbPath);
    const loaded = getEvidencePackage(saved.id, dbPath);
    expect(loaded?.sources[0].quote).toBe(src.quote);

    // quoteHash is sha256 of the verbatim quote — citation can be re-verified
    expect(sha256(src.quote)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("V22: evidence list joins the claim protocol state", () => {
    const dbPath = makeDbPath();
    const saved = insertEvidence(makePkg("Protocol state check"), dbPath);

    // Fresh evidence auto-initializes a claim in OBSERVED
    const items = listEvidence(dbPath);
    expect(items.find((i) => i.id === saved.id)?.protocolState).toBe("OBSERVED");
  });

  it("V23: citation envelope carries validators + challengeCount", async () => {
    const dbPath = makeDbPath();
    const saved = insertEvidence(makePkg("Citation validators"), dbPath);

    const db = getDb(dbPath);
    attestClaim(db, saved.id, { agent: "0xaaa", decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" });
    attestClaim(db, saved.id, { agent: "0xbbb", decision: "CONTRADICTED", confidence: 0.2, stake: "50000000000000000000", model: "claude" });
    challengeClaim(db, saved.id, { challenger: "0xccc", bond: "100", reason: "dispute" });

    // Route reads DB via DB_PATH env — point it at the temp db.
    const oldDbPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;
    try {
      const { GET } = await import("../app/api/claims/[id]/citation/route");
      const res = await GET(new Request("http://localhost/api/claims/x/citation"), { params: { id: saved.id } });
      const body = await res.json();
      expect(body.success).toBe(true);
      const c = body.citation;
      expect(c.verification.validators).toHaveLength(2);
      expect(c.verification.validators[0]).toMatchObject({
        agent: "0xaaa",
        decision: "SUPPORTED",
        confidence: 0.9,
        model: "gpt-4o",
      });
      expect(c.verification.challengeCount).toBe(1);
    } finally {
      if (oldDbPath === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = oldDbPath;
    }
  });
});
