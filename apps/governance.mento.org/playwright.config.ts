import { defineConfig } from "@playwright/test";

const PORT = 3002;

export default defineConfig({
  testDir: "./e2e",
  // INVARIANT: the connected spec shares ONE anvil fork and isolates via
  // consumed evm_snapshot/evm_revert ids, so it must never run in parallel
  // with itself or any future connected spec. Unlike app.mento.org (which has
  // multiple projects and relies on a load-bearing `--workers=1` CLI flag in
  // its npm script), governance has only this one project, so `workers: 1`
  // here is sufficient on its own — always run via
  // `pnpm --filter governance.mento.org test:connected`.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [[process.env.CI ? "github" : "list"]],
  use: { baseURL: `http://localhost:${PORT}` },
  // A plain "connected/**" glob (as in the issue's initial sketch) also
  // matches rpc.ts, which the spec imports — Playwright then rejects it as
  // "should not import test file". Scope to *.spec.ts, matching
  // app.mento.org's project pattern.
  projects: [{ name: "connected", testMatch: /connected\/.*\.spec\.ts/ }],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
