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
