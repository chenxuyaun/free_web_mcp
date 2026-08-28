import { createHash } from "node:crypto";
import { EvidencePackage } from "./types";

/** Canonical JSON + SHA-256 hashing (spec §15).
 *
 * Canonicalization rules (must be deterministic for identical packages):
 *  1. sort object keys alphabetically (deep)
 *  2. no whitespace beyond JSON.stringify default
 *  3. numbers serialized via JSON.stringify (no floats like 1.0000001)
 *
 * Same EvidencePackage -> same hash. Any change -> different hash.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function canonicalJson(pkg: EvidencePackage): string {
  return JSON.stringify(sortKeys(pkg as unknown as JsonValue));
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const key of Object.keys(value as { [k: string]: JsonValue }).sort()) {
      out[key] = sortKeys((value as { [k: string]: JsonValue })[key]);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function evidenceHash(pkg: EvidencePackage): string {
  return sha256(canonicalJson(pkg));
}
