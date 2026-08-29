import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    // Next.js runs with basePath=/webmcp (sub-path deployment), so all
    // navigations and the webServer health check must go through /webmcp.
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000/webmcp",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @free-web-mcp/web build && pnpm --filter @free-web-mcp/web start",
        url: "http://localhost:3000/webmcp/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
