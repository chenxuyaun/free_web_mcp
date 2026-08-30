import { expect, test } from "@playwright/test";

/** Offline e2e flows (Phase E). These cover the evidence CRUD surface that
 *  needs no external network: evidence creation uses the local evidence
 *  engine; search-dependent flows (demo) are covered by live runs, not e2e. */

/** Resolve an app path against baseURL, which carries the Next.js basePath
 *  (e.g. http://localhost:3000/webmcp). Playwright resolves "/x" against the
 *  ORIGIN, dropping the basePath — and with basePath set, the origin root is
 *  a 404 — so app paths must be prefixed explicitly. */
function appUrl(
  info: { project: { use: { baseURL?: string } } },
  path: string,
): string {
  const base = (info.project.use.baseURL ?? "http://localhost:3000/webmcp").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

let evidenceId: string;

test.beforeAll(async ({ request }, workerInfo) => {
  // Create a known evidence record via the API (offline: engine is local).
  const res = await request.post(appUrl(workerInfo, "/api/evidence"), {
    data: {
      claim: { text: "E2E claim: Playwright can create evidence records", type: "fact" },
      supporting: [
        {
          url: "https://e2e.example/source-1",
          title: "E2E Source",
          sourceType: "official",
        },
      ],
      crossVerified: false,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  evidenceId = body.id;
  expect(evidenceId).toMatch(/^EV-\d{6}$/);
});

test("home page renders status board and sections", async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo, "/"));
  await expect(page.getByRole("heading", { name: "Free Web MCP" })).toBeVisible();
  await expect(page.getByText("Project Status")).toBeVisible();
  await expect(page.getByText("Evidence Statistics")).toBeVisible();
  await expect(page.getByText("Agent Identity (ERC-8004)")).toBeVisible();
});

test("evidence list shows the created record and filter works", async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo, "/evidence"));
  await expect(page.getByRole("heading", { name: "Evidence Records" })).toBeVisible();
  await expect(page.getByText(evidenceId)).toBeVisible();

  // Filter by keyword — the record must survive a matching query…
  await page.goto(appUrl(testInfo, "/evidence?q=Playwright"));
  await expect(page.getByText(evidenceId)).toBeVisible();

  // …and vanish under a non-matching one.
  await page.goto(appUrl(testInfo, "/evidence?q=zzz-no-match-zzz"));
  await expect(page.getByText(evidenceId)).toHaveCount(0);
});

test("evidence detail page renders package + action buttons", async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo, `/evidence/${evidenceId}`));
  await expect(page.getByText("E2E claim: Playwright can create evidence records")).toBeVisible();
  await expect(page.getByText("Evidence Hash")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Hash" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();
  await expect(page.getByText("Validator Vote").first()).toBeVisible();
  await expect(page.getByText("Timeline").first()).toBeVisible();
  await expect(page.getByText("Decentralized Storage").first()).toBeVisible();
});

test("export JSON downloads a valid package", async ({ page }, testInfo) => {
  await page.goto(appUrl(testInfo, `/evidence/${evidenceId}`));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe(`${evidenceId}.json`);
});

// ---------------------------------------------------------------------------
// Verification protocol flow (V11) — offline-safe: no chain confirm, so the
// resolution is produced locally; the challenge forces CONSENSUS_VOTE.
// ---------------------------------------------------------------------------

test("protocol lifecycle: attest → challenge → finalize → RESOLVED (API + UI)", async ({ request, page }, testInfo) => {
  // Unique validators per run — reputation accumulates across finalizes, and
  // V3 reputation-weighting would shift the consensus probability on reruns.
  const ts = Date.now().toString(36);
  const agentA = `0xaaa00000000000000000000000000000000000${ts}`;
  const agentB = `0xbbb00000000000000000000000000000000000${ts}`;
  const agentC = `0xccc00000000000000000000000000000000000${ts}`;

  // 1. Create evidence
  const created = await request.post(appUrl(testInfo, "/api/evidence"), {
    data: {
      claim: { text: "E2E protocol claim: attest-challenge-finalize", type: "fact" },
      supporting: [
        { url: "https://e2e.example/proto-1", title: "Proto Source", sourceType: "official" },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  expect(id).toMatch(/^EV-\d{6}$/);

  const api = (path: string) => appUrl(testInfo, path);

  // 2. Attest (two diverse validators, one SUPPORTED one CONTRADICTED)
  const att1 = await request.post(api(`/api/claims/${id}/attest`), {
    data: { agent: agentA, decision: "SUPPORTED", confidence: 0.9, stake: "100000000000000000000", model: "gpt-4o" },
  });
  expect(att1.ok()).toBeTruthy();
  const att2 = await request.post(api(`/api/claims/${id}/attest`), {
    data: { agent: agentB, decision: "CONTRADICTED", confidence: 0.1, stake: "100000000000000000000", model: "claude" },
  });
  expect(att2.ok()).toBeTruthy();

  // 3. Challenge → forces CONSENSUS_VOTE (no 24h window wait)
  const chl = await request.post(api(`/api/claims/${id}/challenge`), {
    data: { challenger: "0xccc", bond: "100000000000000000000", reason: "e2e dispute" },
  });
  expect(chl.ok()).toBeTruthy();
  const chlBody = await chl.json();
  expect(chlBody.state.state).toBe("CHALLENGED");

  // 4. Finalize without confirm (offline — resolution produced locally)
  const fin = await request.post(api(`/api/claims/${id}/finalize`), {
    data: { confirm: false },
  });
  expect(fin.ok()).toBeTruthy();
  const finBody = await fin.json();
  // 0.9 vs 0.1 with equal stakes → knife-edge 0.5 → V14: the dispute stays
  // DISPUTED (no manufactured certainty); a decisive consensus is required.
  expect(finBody.state.state).toBe("DISPUTED");
  expect(finBody.state.resolution).toBe(null);
  expect(finBody.state.escalated).toBe(true);

  // 5. A new independent validator breaks the knife-edge → RESOLVED
  const att3 = await request.post(api(`/api/claims/${id}/attest`), {
    data: { agent: agentC, decision: "CONTRADICTED", confidence: 0.05, stake: "100000000000000000000", model: "gemini" },
  });
  expect(att3.ok()).toBeTruthy();
  const fin2 = await request.post(api(`/api/claims/${id}/finalize`), {
    data: { confirm: false },
  });
  const fin2Body = await fin2.json();
  expect(fin2Body.state.state).toBe("RESOLVED");
  expect(fin2Body.state.resolution.method).toBe("CONSENSUS_VOTE");
  expect(fin2Body.state.resolution.tier).toBe("L2_AI_VALIDATORS");

  // 6. UI shows the resolved state with tier + effective votes
  await page.goto(appUrl(testInfo, `/evidence/${id}`));
  await expect(page.getByText("RESOLVED").first()).toBeVisible();
  await expect(page.getByText("L2 AI_VALIDATORS").first()).toBeVisible();
  await expect(page.getByText(/effective independent/).first()).toBeVisible();
});
