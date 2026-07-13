import { defineConfig, type ReporterDescription } from "@playwright/test";

const PORT = 3000;

const reporter: ReporterDescription[] = [];
if (process.env.ARGOS_TOKEN) {
  // Distinct build name so this app's Argos build/check doesn't collide with
  // ui.mento.org's (which uses the default).
  reporter.push([
    "@argos-ci/playwright/reporter",
    { buildName: "app.mento.org" },
  ]);
}
reporter.push([process.env.CI ? "github" : "list"]);

if (process.env.CI && !process.env.ARGOS_TOKEN) {
  console.warn(
    "[visual] ARGOS_TOKEN not set in CI — screenshots captured but NOT uploaded/compared (expected on forked PRs).",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter,
  use: { baseURL: `http://localhost:${PORT}`, deviceScaleFactor: 1 },
  projects: [
    {
      name: "desktop",
      testIgnore: /connected\//,
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      testIgnore: /connected\//,
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      // INVARIANT: all connected specs share ONE anvil fork and isolate via
      // consumed evm_snapshot/evm_revert ids, so they must never run in
      // parallel. `fullyParallel: false` only serializes tests WITHIN a spec
      // file, not across spec files, and Playwright has no per-project
      // `workers` option — the `--workers=1` flag in the `test:connected`
      // npm script is load-bearing. Always run this project via
      // `pnpm --filter app.mento.org test:connected`, never via a bare
      // `playwright test --project=connected`.
      name: "connected",
      testMatch: /connected\/.*\.spec\.ts/,
      fullyParallel: false,
      // Headroom above the sum of the swap spec's chained assertion budgets
      // (20s connect + 30s enable + 60s approve + 30s confirm + 30s enable +
      // 60s swap ≈ 230s worst case on the approve path) — same rationale as
      // the governance connected project's 240s budget.
      timeout: 240_000,
      use: { viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
