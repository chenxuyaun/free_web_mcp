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

/** Combine two hex hashes (concatenated, then sha256) — the internal-node
 *  rule for the Merkle tree. Order matters: (left, right) is asymmetric. */
export function combineHash(left: string, right: string): string {
  return sha256(left + right);
}

/** Build a binary Merkle tree from an ordered list of leaf hashes and return
 *  the root hash (64 lowercase hex chars, sha256-based).
 *
 *  Rules:
 *  - even-count layers pair up as (i, i+1); an odd trailing leaf is paired
 *    with an EMPTY_NODE = sha256("") so the tree is always balanced-ish and
 *    the root is deterministic for a given leaf set.
 *  - a single leaf's root is that leaf itself.
 *  - an empty leaf list hashes to the empty node (shouldn't happen in
 *    practice — a resolution always has at least an outcome leaf).
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256("");
  let layer = leaves;
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : sha256("");
      next.push(combineHash(left, right));
    }
    layer = next;
  }
  return layer[0];
}

/** One proof entry: a sibling hash plus whether it sits LEFT of the current
 *  node (concatenation order matters — combineHash is asymmetric). */
export interface MerkleProofEntry {
  hash: string;
  isLeft: boolean;
}

/** Build a Merkle proof for a leaf at `index` in the ordered leaf list.
 *  Each entry is the sibling of the current node at that layer, rootward.
 *  Odd layers pad the pair with an empty node, matching merkleRoot. */
export function merkleProof(leaves: string[], index: number): MerkleProofEntry[] {
  if (index < 0 || index >= leaves.length) throw new Error("Leaf index out of range");
  const proof: MerkleProofEntry[] = [];
  let layer = [...leaves];
  let idx = index;
  while (layer.length > 1) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const siblingHash = siblingIdx < layer.length ? layer[siblingIdx] : sha256("");
    proof.push({ hash: siblingHash, isLeft: siblingIdx < idx });
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const l = layer[i];
      const r = i + 1 < layer.length ? layer[i + 1] : sha256("");
      next.push(combineHash(l, r));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verify a leaf against a Merkle root using a proof. */
export function verifyMerkleProof(leaf: string, proof: MerkleProofEntry[], root: string): boolean {
  let hash = leaf;
  for (const entry of proof) {
    hash = entry.isLeft ? combineHash(entry.hash, hash) : combineHash(hash, entry.hash);
  }
  return hash === root;
}
