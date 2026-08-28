/** SQLite persistence for evidence packages (M4).
 *
 * Single-file DB at apps/web/data/evidence.db by default (override with DB_PATH).
 * Uses a module-level singleton keyed by path so Next.js dev hot-reload and
 * vitest (which passes a per-test temp path) coexist safely.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { EvidencePackage } from "@free-web-mcp/evidence";

export interface EvidenceRowSummary {
  id: string;
  claimText: string;
  claimType: string;
  status: string;
  confidence: number;
  hash: string;
  anchored: boolean;
  createdAt: string;
}

export interface EvidenceStats {
  totalClaims: number;
  totalEvidence: number;
  verifiedClaims: number;
  counterEvidenceFound: number;
  onChainRecords: number;
}

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "evidence.db");

type Db = Database.Database;

const globalForDb = globalThis as unknown as { __evidenceDbPool?: Map<string, Db> };

function pool(): Map<string, Db> {
  globalForDb.__evidenceDbPool ??= new Map<string, Db>();
  return globalForDb.__evidenceDbPool;
}

export function getDb(dbPath: string = process.env.DB_PATH || DEFAULT_DB_PATH): Db {
  const existing = pool().get(dbPath);
  if (existing) {
    // Schema may have evolved since the connection was first opened
    // (e.g. new tables added while the dev server kept running).
    ensureSchema(existing);
    return existing;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  pool().set(dbPath, db);
  return db;
}

/** Idempotent schema bootstrap — safe to run on every open, also used by tests. */
export function ensureSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence (
      id            TEXT PRIMARY KEY,
      claim_text    TEXT NOT NULL,
      claim_type    TEXT NOT NULL,
      status        TEXT NOT NULL,
      confidence    REAL NOT NULL,
      hash          TEXT NOT NULL,
      anchored      INTEGER NOT NULL DEFAULT 0,
      package_json  TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS validators (
      address              TEXT PRIMARY KEY,
      reputation           REAL NOT NULL DEFAULT 0,
      verified_claims      INTEGER NOT NULL DEFAULT 0,
      successful_challenges INTEGER NOT NULL DEFAULT 0,
      total_votes          INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS votes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      evidence_id    TEXT NOT NULL,
      validator      TEXT NOT NULL,
      vote           TEXT NOT NULL,
      correct        INTEGER NOT NULL DEFAULT 0,
      reward_amount  TEXT,
      reward_tx      TEXT,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migration: older DBs predate challenge_of (M1B challenge rewards).
  const voteCols = (db.pragma("table_info(votes)") as Array<{ name: string }>).map((c) => c.name);
  if (!voteCols.includes("challenge_of")) {
    db.exec("ALTER TABLE votes ADD COLUMN challenge_of TEXT");
  }

  // Migration: evidence rows predate greenfieldUri (Phase G decentralized storage).
  const evCols = (db.pragma("table_info(evidence)") as Array<{ name: string }>).map((c) => c.name);
  if (!evCols.includes("greenfield_uri")) {
    db.exec("ALTER TABLE evidence ADD COLUMN greenfield_uri TEXT");
  }
}

export function closeDb(dbPath?: string): void {
  const p = pool();
  if (dbPath) {
    p.get(dbPath)?.close();
    p.delete(dbPath);
  } else {
    for (const db of p.values()) db.close();
    p.clear();
  }
}

function nextId(db: Db): string {
  const row = db
    .prepare(
      "SELECT id FROM evidence WHERE id LIKE 'EV-%' ORDER BY CAST(substr(id, 4) AS INTEGER) DESC LIMIT 1",
    )
    .get() as { id: string } | undefined;
  const last = row ? parseInt(row.id.slice(3), 10) : 0;
  return `EV-${String(last + 1).padStart(6, "0")}`;
}

export interface InsertInput {
  pkg: EvidencePackage;
  hash: string;
}

export function insertEvidence(input: InsertInput, dbPath?: string): EvidencePackage {
  const db = getDb(dbPath);
  const pkg = input.pkg;
  const id = nextId(db);
  const withId: EvidencePackage = { ...pkg, id };
  db.prepare(
    `INSERT INTO evidence (id, claim_text, claim_type, status, confidence, hash, anchored, package_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    withId.claim.text,
    withId.claim.type,
    withId.assessment.status,
    withId.assessment.confidence,
    input.hash,
    0,
    JSON.stringify(withId),
    withId.provenance.createdAt,
  );
  return withId;
}

export function listEvidence(
  opts?: { status?: string; q?: string; limit?: number } | string,
  maybeDbPath?: string,
): EvidenceRowSummary[] {
  // Back-compat: first arg may be a dbPath string.
  let status: string | undefined;
  let q: string | undefined;
  let limit: number | undefined;
  let dbPath: string | undefined = maybeDbPath;
  if (typeof opts === "string") {
    dbPath = opts;
  } else if (opts && typeof opts === "object") {
    ({ status, q, limit } = opts);
  }
  const db = getDb(dbPath);
  const conds: string[] = [];
  const params: Array<string> = [];
  if (status) {
    conds.push("status = ?");
    params.push(status);
  }
  if (q) {
    conds.push("(claim_text LIKE ? OR id LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const lim = limit ? `LIMIT ${Number(limit)}` : "";
  const rows = db
    .prepare(
      `SELECT id, claim_text, claim_type, status, confidence, hash, anchored, created_at FROM evidence ${where} ORDER BY created_at DESC ${lim}`,
    )
    .all(...params) as Array<{
    id: string;
    claim_text: string;
    claim_type: string;
    status: string;
    confidence: number;
    hash: string;
    anchored: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    claimText: r.claim_text,
    claimType: r.claim_type,
    status: r.status,
    confidence: r.confidence,
    hash: r.hash,
    anchored: r.anchored === 1,
    createdAt: r.created_at,
  }));
}

export function getEvidencePackage(id: string, dbPath?: string): EvidencePackage | null {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT package_json FROM evidence WHERE id = ?").get(id) as
    | { package_json: string }
    | undefined;
  if (!row) return null;
  return JSON.parse(row.package_json) as EvidencePackage;
}

/** The canonical SHA-256 evidence hash stored at create time. */
export function getEvidenceHash(id: string, dbPath?: string): string | null {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT hash FROM evidence WHERE id = ?").get(id) as
    | { hash: string }
    | undefined;
  return row?.hash ?? null;
}

export function markAnchored(
  id: string,
  blockchain: NonNullable<EvidencePackage["blockchain"]>,
  dbPath?: string,
): boolean {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT package_json FROM evidence WHERE id = ?").get(id) as
    | { package_json: string }
    | undefined;
  if (!row) return false;
  const pkg = JSON.parse(row.package_json) as EvidencePackage;
  pkg.blockchain = blockchain;
  const res = db
    .prepare("UPDATE evidence SET anchored = 1, package_json = ? WHERE id = ?")
    .run(JSON.stringify(pkg), id);
  return res.changes > 0;
}

/** Store the Greenfield URI for an evidence record after publishing (Phase G). */
export function markPublished(id: string, greenfieldUri: string, dbPath?: string): boolean {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT package_json FROM evidence WHERE id = ?").get(id) as
    | { package_json: string }
    | undefined;
  if (!row) return false;
  const pkg = JSON.parse(row.package_json) as EvidencePackage;
  pkg.storage = { uri: greenfieldUri, kind: "greenfield" };
  const res = db
    .prepare("UPDATE evidence SET greenfield_uri = ?, package_json = ? WHERE id = ?")
    .run(greenfieldUri, JSON.stringify(pkg), id);
  return res.changes > 0;
}

export function getGreenfieldUri(id: string, dbPath?: string): string | null {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT greenfield_uri FROM evidence WHERE id = ?").get(id) as
    | { greenfield_uri: string | null }
    | undefined;
  return row?.greenfield_uri ?? null;
}

export function getStats(dbPath?: string): EvidenceStats {
  const db = getDb(dbPath);
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                        AS totalEvidence,
         SUM(CASE WHEN status IN ('SUPPORTED','LIKELY_TRUE') THEN 1 ELSE 0 END) AS verifiedClaims,
         SUM(CASE WHEN status = 'CONTRADICTED' THEN 1 ELSE 0 END)               AS contradicted,
         SUM(CASE WHEN anchored = 1 THEN 1 ELSE 0 END)                          AS onChainRecords
       FROM evidence`,
    )
    .get() as {
    totalEvidence: number;
    verifiedClaims: number | null;
    contradicted: number | null;
    onChainRecords: number | null;
  };
  return {
    totalClaims: row.totalEvidence, // one claim per package in v1
    totalEvidence: row.totalEvidence,
    verifiedClaims: row.verifiedClaims ?? 0,
    counterEvidenceFound: row.contradicted ?? 0,
    onChainRecords: row.onChainRecords ?? 0,
  };
}

export function countEvidence(dbPath?: string): number {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT COUNT(*) AS c FROM evidence").get() as { c: number };
  return row.c;
}

// ---------- Validator (spec §25-26) ----------

export type ValidatorVote = "SUPPORT" | "CONTRADICT" | "UNCERTAIN";

export interface VoteRecord {
  id: number;
  evidenceId: string;
  validator: string;
  vote: ValidatorVote;
  correct: boolean;
  rewardAmount: string | null;
  rewardTx: string | null;
  challengeOf: string | null;
  createdAt: string;
}

export interface ValidatorStats {
  address: string;
  reputation: number;
  verifiedClaims: number;
  successfulChallenges: number;
  totalVotes: number;
}

/** Map a system assessment status to the validator vote it implies
 *  (SUPPORTED/LIKELY_TRUE → SUPPORT; CONTRADICTED → CONTRADICT; else UNCERTAIN). */
export function assessmentToExpectedVote(status: string): ValidatorVote {
  if (status === "SUPPORTED" || status === "LIKELY_TRUE") return "SUPPORT";
  if (status === "CONTRADICTED") return "CONTRADICT";
  return "UNCERTAIN";
}

export function recordVote(input: {
  evidenceId: string;
  validator: string;
  vote: ValidatorVote;
  rewardAmount?: string | null;
  rewardTx?: string | null;
}, dbPath?: string): VoteRecord {
  const db = getDb(dbPath);
  const pkg = getEvidencePackage(input.evidenceId, dbPath);
  if (!pkg) throw new Error(`Evidence ${input.evidenceId} not found.`);

  const expected = assessmentToExpectedVote(pkg.assessment.status);
  const correct = input.vote === expected;
  const now = new Date().toISOString();

  // Challenge (spec §25-26): a correct CONTRADICT vote against an evidence
  // that another validator previously (correctly) SUPPORTED is a successful
  // challenge of that earlier verification.
  let challengeOf: string | null = null;
  if (input.vote === "CONTRADICT" && correct) {
    const prior = db
      .prepare(
        `SELECT validator FROM votes
         WHERE evidence_id = ? AND vote = 'SUPPORT' AND validator != ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.evidenceId, input.validator.toLowerCase()) as { validator: string } | undefined;
    challengeOf = prior?.validator ?? null;
  }

  db.prepare(
    `INSERT INTO votes (evidence_id, validator, vote, correct, reward_amount, reward_tx, challenge_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.evidenceId,
    input.validator.toLowerCase(),
    input.vote,
    correct ? 1 : 0,
    input.rewardAmount ?? null,
    input.rewardTx ?? null,
    challengeOf,
    now,
  );

  // Upsert validator stats
  db.prepare(
    `INSERT INTO validators (address, reputation, verified_claims, successful_challenges, total_votes, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(address) DO UPDATE SET
       reputation = reputation + ?,
       verified_claims = verified_claims + ?,
       successful_challenges = successful_challenges + ?,
       total_votes = total_votes + 1`,
  ).run(
    input.validator.toLowerCase(),
    correct ? 1 : 0,
    correct ? 1 : 0,
    input.vote === "CONTRADICT" && correct ? 1 : 0,
    now,
    correct ? 1 : 0,
    correct ? 1 : 0,
    input.vote === "CONTRADICT" && correct ? 1 : 0,
  );

  const row = db
    .prepare("SELECT * FROM votes WHERE id = last_insert_rowid()")
    .get() as {
    id: number;
    evidence_id: string;
    validator: string;
    vote: string;
    correct: number;
    reward_amount: string | null;
    reward_tx: string | null;
    challenge_of: string | null;
    created_at: string;
  };
  return {
    id: row.id,
    evidenceId: row.evidence_id,
    validator: row.validator,
    vote: row.vote as ValidatorVote,
    correct: row.correct === 1,
    rewardAmount: row.reward_amount,
    rewardTx: row.reward_tx,
    challengeOf: row.challenge_of,
    createdAt: row.created_at,
  };
}

export function listVotesForEvidence(evidenceId: string, dbPath?: string): VoteRecord[] {
  const db = getDb(dbPath);
  const rows = db
    .prepare("SELECT * FROM votes WHERE evidence_id = ? ORDER BY created_at ASC")
    .all(evidenceId) as Array<{
    id: number;
    evidence_id: string;
    validator: string;
    vote: string;
    correct: number;
    reward_amount: string | null;
    reward_tx: string | null;
    challenge_of: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    evidenceId: r.evidence_id,
    validator: r.validator,
    vote: r.vote as ValidatorVote,
    correct: r.correct === 1,
    rewardAmount: r.reward_amount,
    rewardTx: r.reward_tx,
    challengeOf: r.challenge_of,
    createdAt: r.created_at,
  }));
}

export function getValidatorStats(address: string, dbPath?: string): ValidatorStats | null {
  const db = getDb(dbPath);
  const row = db
    .prepare("SELECT * FROM validators WHERE address = ?")
    .get(address.toLowerCase()) as
    | {
        address: string;
        reputation: number;
        verified_claims: number;
        successful_challenges: number;
        total_votes: number;
      }
    | undefined;
  if (!row) return null;
  return {
    address: row.address,
    reputation: row.reputation,
    verifiedClaims: row.verified_claims,
    successfulChallenges: row.successful_challenges,
    totalVotes: row.total_votes,
  };
}

export function listVotes(dbPath?: string): VoteRecord[] {
  const db = getDb(dbPath);
  const rows = db
    .prepare("SELECT * FROM votes ORDER BY created_at DESC LIMIT 50")
    .all() as Array<{
    id: number;
    evidence_id: string;
    validator: string;
    vote: string;
    correct: number;
    reward_amount: string | null;
    reward_tx: string | null;
    challenge_of: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    evidenceId: r.evidence_id,
    validator: r.validator,
    vote: r.vote as ValidatorVote,
    correct: r.correct === 1,
    rewardAmount: r.reward_amount,
    rewardTx: r.reward_tx,
    challengeOf: r.challenge_of,
    createdAt: r.created_at,
  }));
}

export function listValidators(dbPath?: string): ValidatorStats[] {
  const db = getDb(dbPath);
  const rows = db
    .prepare("SELECT * FROM validators ORDER BY reputation DESC LIMIT 20")
    .all() as Array<{
    address: string;
    reputation: number;
    verified_claims: number;
    successful_challenges: number;
    total_votes: number;
  }>;
  return rows.map((r) => ({
    address: r.address,
    reputation: r.reputation,
    verifiedClaims: r.verified_claims,
    successfulChallenges: r.successful_challenges,
    totalVotes: r.total_votes,
  }));
}

/** True if another validator previously voted SUPPORT on this evidence —
 *  the precondition for a successful challenge (M1B). */
export function priorSupportExists(evidenceId: string, validator: string, dbPath?: string): boolean {
  const db = getDb(dbPath);
  const row = db
    .prepare(
      `SELECT 1 FROM votes
       WHERE evidence_id = ? AND vote = 'SUPPORT' AND validator != ?
       LIMIT 1`,
    )
    .get(evidenceId, validator.toLowerCase());
  return row !== undefined;
}

// ---------- App meta kv (agent identity etc.) ----------

export function getMeta(key: string, dbPath?: string): string | null {
  const db = getDb(dbPath);
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string, dbPath?: string): void {
  const db = getDb(dbPath);
  db.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
