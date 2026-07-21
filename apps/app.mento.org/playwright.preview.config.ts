import { defineConfig } from "@playwright/test";

// NOTE: PREVIEW_URL is NOT validated here (module load time) — static
// tooling that imports this config for introspection (e.g. knip's Playwright
// plugin, run env-var-free in `pnpm knip`) would break on a throw at this
// point. The fail-fast check lives in e2e/preview/smoke.spec.ts's
// `test.beforeAll`, matching the preflight-check convention in
// e2e/connected/swap.spec.ts.

// Walletless preview smoke: no webServer (the target is already deployed),
// no network blocking, no clock freezing — this exercises real deployed
// infra (real forno reads) rather than a deterministic local snapshot. See
// docs/wallet-testing.md's "Preview smoke" section and
// .github/workflows/_vercel-preview-smoke.yml, which sets PREVIEW_URL from a
// trusted, target-bound deployment tuple.
export default defineConfig({
  testDir: "./e2e/preview",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [[process.env.CI ? "github" : "list"]],
  use: {
    baseURL: process.env.PREVIEW_URL,
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "preview" }],
});
