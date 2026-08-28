/** Seed 3 demo evidence packages (one per representative status) into the
 *  SQLite store so the dashboard has visible content for M4 verification.
 *
 *  Run: pnpm -w exec tsx scripts/seed-demo.ts
 */

import { buildEvidencePackage, sha256, type EvidenceSource } from "@free-web-mcp/evidence";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "apps/web/data/evidence.db");

const retrievedAt = new Date().toISOString();

const src = (
  url: string,
  title: string,
  sourceType: EvidenceSource["sourceType"],
  publishedAt?: string,
): EvidenceSource => ({
  url,
  title,
  sourceType,
  publishedAt,
  retrievedAt,
  contentHash: sha256(`content-of-${url}`),
});

interface SeedSpec {
  claim: string;
  type: "fact" | "event" | "number" | "date";
  supporting: EvidenceSource[];
  contradicting?: EvidenceSource[];
  crossVerified: boolean;
  counterSearches?: string[];
}

const seeds: SeedSpec[] = [
  {
    claim: "Anthropic released the Model Context Protocol in November 2024",
    type: "event",
    supporting: [
      src("https://www.anthropic.com/news/model-context-protocol", "Anthropic Newsroom", "official", "2024-11-25"),
      src("https://en.wikipedia.org/wiki/Model_Context_Protocol", "Wikipedia: MCP", "secondary", "2025-04-14"),
      src("https://modelcontextprotocol.io/docs/getting-started/intro", "MCP Official Docs", "official", "2024-11-25"),
    ],
    crossVerified: true,
    counterSearches: [
      '"Anthropic released the Model Context Protocol in November 2024" fact check',
      '"Model Context Protocol" announced date',
    ],
  },
  {
    claim: "The MCP protocol requires all servers to implement every primitive",
    type: "fact",
    supporting: [
      src("https://some-random-blog.example/mcp-explained", "Random Blog", "unknown"),
    ],
    contradicting: [
      src("https://modelcontextprotocol.io/specification", "MCP Specification (official)", "official"),
    ],
    crossVerified: false,
    counterSearches: ['"MCP servers must implement" primitives specification'],
  },
  {
    claim: "Over 10,000 companies used MCP in production by 2026",
    type: "number",
    supporting: [],
    crossVerified: false,
    counterSearches: ['"10,000 companies" MCP production survey'],
  },
];

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

const count = db.prepare("SELECT COUNT(*) AS c FROM evidence").get() as { c: number };
if (count.c > 0) {
  console.log(`DB already has ${count.c} evidence rows — skipping seed.`);
  process.exit(0);
}

let n = 0;
for (const s of seeds) {
  n++;
  const { pkg, hash } = buildEvidencePackage({
    id: "EV-TEMP",
    claimText: s.claim,
    claimType: s.type,
    supporting: s.supporting,
    contradicting: s.contradicting ?? [],
    counterEvidence: {
      claim: s.claim,
      searches: s.counterSearches ?? [],
      sources: s.contradicting ?? [],
      found: (s.contradicting?.length ?? 0) > 0,
    },
    crossVerified: s.crossVerified,
  });
  const id = `EV-${String(n).padStart(6, "0")}`;
  const withId = { ...pkg, id };
  db.prepare(
    `INSERT INTO evidence (id, claim_text, claim_type, status, confidence, hash, anchored, package_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    withId.claim.text,
    withId.claim.type,
    withId.assessment.status,
    withId.assessment.confidence,
    hash,
    JSON.stringify(withId),
    withId.provenance.createdAt,
  );
  console.log(`${id}  ${withId.assessment.status.padEnd(22)} conf=${withId.assessment.confidence}  ${s.claim.slice(0, 50)}…`);
}

console.log(`\nSeeded ${seeds.length} evidence packages into ${dbPath}`);
