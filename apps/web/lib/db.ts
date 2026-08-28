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
  if (existing) return existing;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
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
  `);
  pool().set(dbPath, db);
  return db;
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

export function listEvidence(dbPath?: string): EvidenceRowSummary[] {
  const db = getDb(dbPath);
  const rows = db
    .prepare(
      "SELECT id, claim_text, claim_type, status, confidence, hash, anchored, created_at FROM evidence ORDER BY created_at DESC",
    )
    .all() as Array<{
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
