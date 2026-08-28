import { CounterEvidence, EvidenceSource, VerificationResult } from "./types";

/** EvidenceEngine core (spec §10-§13).
 *
 * Implements:
 *  - source scoring (source quality + independence)
 *  - verification with supporting/contradicting/independent/duplicate counts
 *  - counter-evidence search directions (no LLM — rule-based)
 *  - assessment (status + confidence)
 *
 *  Principle (spec §18): "no counter-evidence found" is NEVER "proven true".
 */

export interface EvidenceEngineOptions {
  engineVersion?: string;
  /** Treat a domain as the same source if it appears in this many sources. */
  independenceThreshold?: number;
}

export interface SearchDirectionInput {
  claim: string;
}

export class EvidenceEngine {
  readonly engineVersion: string;
  readonly independenceThreshold: number;

  constructor(opts: EvidenceEngineOptions = {}) {
    this.engineVersion = opts.engineVersion ?? "0.1.0";
    this.independenceThreshold = opts.independenceThreshold ?? 2;
  }

  /** Score a source 0..1 based on its declared type. */
  sourceQualityScore(source: EvidenceSource): number {
    const map: Record<EvidenceSource["sourceType"], number> = {
      official: 1.0,
      primary: 0.95,
      major_media: 0.8,
      professional: 0.7,
      secondary: 0.5,
      unknown: 0.3,
      social: 0.15,
    };
    return map[source.sourceType] ?? 0.3;
  }

  /** Group sources by registrable domain to compute independence. */
  private registrableDomain(url: string): string {
    try {
      const u = new URL(url);
      const parts = u.hostname.split(".");
      if (parts.length >= 3) {
        // naive: last two labels (co.uk etc. not handled — acceptable for v1)
        return parts.slice(-2).join(".");
      }
      return u.hostname;
    } catch {
      return "invalid";
    }
  }

  /** Compute independent vs duplicate source counts (spec §12). */
  independenceStats(sources: EvidenceSource[]): {
    independentSources: number;
    duplicateSources: number;
  } {
    const seen = new Set<string>();
    let independent = 0;
    let duplicate = 0;
    for (const s of sources) {
      const domain = this.registrableDomain(s.url);
      if (seen.has(domain)) {
        duplicate++;
      } else {
        seen.add(domain);
        independent++;
      }
    }
    return { independentSources: independent, duplicateSources: duplicate };
  }

  /** Verify a claim against a set of sources (spec §12).
   *  `supporting` and `contradicting` are pre-classified by the caller
   *  (usually by a search + matching step). */
  verifyEvidence(opts: {
    supporting: EvidenceSource[];
    contradicting: EvidenceSource[];
    crossVerified: boolean;
  }): VerificationResult {
    const supporting = opts.supporting;
    const contradicting = opts.contradicting;
    const indep = this.independenceStats(supporting);
    const all = [...supporting, ...contradicting];
    const anyTraceable = all.some((s) => s.contentHash !== "" && s.retrievedAt !== "");

    // Confidence heuristic (spec §12: no "3 sites = true").
    // Start from quality-weighted supporting sources, penalize duplicates,
    // cap by cross-verification.
    let confidence = 0;
    if (supporting.length > 0) {
      const avgQuality =
        supporting.reduce((acc, s) => acc + this.sourceQualityScore(s), 0) / supporting.length;
      const independenceFactor =
        indep.independentSources > 0
          ? 1 - Math.min(0.5, indep.duplicateSources / Math.max(supporting.length, 1) / 2)
          : 0.3;
      confidence = avgQuality * independenceFactor;
      if (opts.crossVerified) confidence = Math.min(1, confidence + 0.15);
      else confidence = Math.max(0, confidence - 0.1);
    }
    if (contradicting.length > 0) {
      // Contradiction strongly reduces confidence.
      confidence *= 0.4;
    }

    let status: VerificationResult["status"];
    if (contradicting.length > 0 && supporting.length > 0) {
      status = "CONTRADICTED";
    } else if (contradicting.length > 0 && supporting.length === 0) {
      status = "CONTRADICTED";
    } else if (supporting.length >= 2 && indep.independentSources >= 2 && opts.crossVerified) {
      status = confidence >= 0.6 ? "SUPPORTED" : "LIKELY_TRUE";
    } else if (supporting.length >= 1) {
      status = "LIKELY_TRUE";
    } else {
      status = "INSUFFICIENT_EVIDENCE";
    }

    return {
      supportingSources: supporting.length,
      contradictingSources: contradicting.length,
      independentSources: indep.independentSources,
      duplicateSources: indep.duplicateSources,
      sourceTraceable: anyTraceable,
      crossVerified: opts.crossVerified,
      status,
      confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
    };
  }

  /** Generate counter-evidence search directions (spec §13). */
  findCounterEvidence(claim: string): CounterEvidence {
    const searches = [
      `"${claim}" 辟谣`,
      `"${claim}" fact check`,
      `"${claim}" debunked`,
      `"${claim}" false`,
      `"${claim}" correction`,
    ];
    return { claim, searches, sources: [], found: false };
  }

  /** Final assessment (spec §14 assessment block). */
  calculateAssessment(verification: VerificationResult) {
    return {
      status: verification.status,
      confidence: verification.confidence,
    };
  }
}
