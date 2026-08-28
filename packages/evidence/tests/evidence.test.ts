import { describe, expect, it } from "vitest";
import { EvidenceEngine } from "../src/engine";
import { buildEvidencePackage } from "../src/package";
import { canonicalJson, evidenceHash, sha256 } from "../src/hash";
import { EvidencePackage } from "../src/types";
import { classifyClaim, extractClaims } from "../src/claims";

const mkSource = (url: string, sourceType: EvidencePackage["sources"][number]["sourceType"], title = "x") => ({
  url,
  title,
  sourceType,
  publishedAt: "2026-01-01T00:00:00Z",
  retrievedAt: "2026-08-01T00:00:00Z",
  contentHash: sha256("content-" + url),
});

describe("EvidenceEngine", () => {
  const engine = new EvidenceEngine();

  it("scores official > major_media > social", () => {
    expect(engine.sourceQualityScore(mkSource("https://gov.example", "official"))).toBe(1.0);
    expect(engine.sourceQualityScore(mkSource("https://news.example", "major_media"))).toBe(0.8);
    expect(engine.sourceQualityScore(mkSource("https://t.example", "social"))).toBe(0.15);
  });

  it("counts independent vs duplicate sources (same domain = duplicate)", () => {
    const sources = [
      mkSource("https://a.example/1", "official"),
      mkSource("https://a.example/2", "official"), // same domain
      mkSource("https://b.example/1", "major_media"),
      mkSource("https://c.example/1", "major_media"),
    ];
    const stats = engine.independenceStats(sources);
    expect(stats.independentSources).toBe(3);
    expect(stats.duplicateSources).toBe(1);
  });

  it("two independent + cross-verified => SUPPORTED with high confidence", () => {
    const supporting = [
      mkSource("https://gov.example/1", "official"),
      mkSource("https://news.example/1", "major_media"),
    ];
    const v = engine.verifyEvidence({ supporting, contradicting: [], crossVerified: true });
    expect(v.status).toBe("SUPPORTED");
    expect(v.confidence).toBeGreaterThanOrEqual(0.6);
    expect(v.independentSources).toBe(2);
  });

  it("one source => LIKELY_TRUE, not SUPPORTED", () => {
    const v = engine.verifyEvidence({
      supporting: [mkSource("https://a.example/1", "official")],
      contradicting: [],
      crossVerified: false,
    });
    expect(v.status).toBe("LIKELY_TRUE");
    expect(v.crossVerified).toBe(false);
  });

  it("contradiction => CONTRADICTED regardless of support count", () => {
    const v = engine.verifyEvidence({
      supporting: [mkSource("https://a.example/1", "official")],
      contradicting: [mkSource("https://b.example/1", "official")],
      crossVerified: false,
    });
    expect(v.status).toBe("CONTRADICTED");
  });

  it("no sources => INSUFFICIENT_EVIDENCE (never SUPPORTED)", () => {
    const v = engine.verifyEvidence({ supporting: [], contradicting: [], crossVerified: false });
    expect(v.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(v.confidence).toBe(0);
  });

  it("finds counter-evidence search directions (rule-based)", () => {
    const ce = engine.findCounterEvidence("Company X released Product Y in 2026");
    expect(ce.searches.length).toBeGreaterThanOrEqual(3);
    expect(ce.found).toBe(false);
    expect(ce.claim).toContain("Company X");
  });
});

describe("Claim extraction", () => {
  it("classifies facts vs opinions vs inferences", () => {
    expect(classifyClaim("The sky is blue today.")).toBe("fact");
    expect(classifyClaim("I think this product is great.")).toBe("opinion");
    expect(classifyClaim("Thus the economy is recovering.")).toBe("inference");
  });

  it("extracts multiple claims from multi-sentence text", () => {
    const text = "Anthropic released MCP in 2024. I believe it will dominate. Revenue hit $100 million.";
    const claims = extractClaims(text);
    expect(claims.length).toBe(3);
    const types = claims.map((c) => c.type);
    expect(types).toContain("event"); // "released"
    expect(types).toContain("opinion");
    expect(types).toContain("number"); // "$100 million"
    expect(claims[0].id).toBe("claim_001");
  });
});

describe("Evidence hash", () => {
  const base = buildEvidencePackage({
    id: "EV-000001",
    claimText: "Anthropic released MCP in 2024",
    claimType: "event",
    supporting: [mkSource("https://gov.example/1", "official")],
    crossVerified: false,
    createdAt: "2026-08-01T00:00:00.000Z",
  }).pkg;

  it("same package -> same hash (deterministic)", () => {
    const a = buildEvidencePackage({
      id: "EV-000001",
      claimText: "Anthropic released MCP in 2024",
      claimType: "event",
      supporting: [mkSource("https://gov.example/1", "official")],
      crossVerified: false,
      createdAt: "2026-08-01T00:00:00.000Z",
    }).pkg;
    expect(evidenceHash(a)).toBe(evidenceHash(base));
  });

  it("canonical JSON is key-sorted (deep)", () => {
    const json = canonicalJson(base);
    const obj = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(obj).sort()).toEqual(Object.keys(obj));
  });

  it("changed claim -> different hash", () => {
    const changed = buildEvidencePackage({
      id: "EV-000001",
      claimText: "Anthropic released MCP in 2025", // year changed
      claimType: "event",
      supporting: [mkSource("https://gov.example/1", "official")],
      crossVerified: false,
    }).pkg;
    expect(evidenceHash(changed)).not.toBe(evidenceHash(base));
  });

  it("changed source -> different hash", () => {
    const changed = buildEvidencePackage({
      id: "EV-000001",
      claimText: "Anthropic released MCP in 2024",
      claimType: "event",
      supporting: [mkSource("https://OTHER.example/1", "official")],
      crossVerified: false,
    }).pkg;
    expect(evidenceHash(changed)).not.toBe(evidenceHash(base));
  });

  it("hash is a 64-char hex sha256", () => {
    const h = evidenceHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildEvidencePackage", () => {
  it("produces a full package with provenance and blockchain:null", () => {
    const { pkg, hash } = buildEvidencePackage({
      id: "EV-000001",
      claimText: "Anthropic released MCP in 2024",
      claimType: "event",
      supporting: [
        mkSource("https://gov.example/1", "official"),
        mkSource("https://news.example/1", "major_media"),
      ],
      crossVerified: true,
    });
    expect(pkg.id).toBe("EV-000001");
    expect(pkg.provenance.hashAlgorithm).toBe("SHA-256");
    expect(pkg.blockchain).toBeNull();
    expect(pkg.verification.crossVerified).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
