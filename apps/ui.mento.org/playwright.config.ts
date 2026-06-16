import { defineConfig, type ReporterDescription } from "@playwright/test";

const PORT = 3003;

// Upload to Argos only when a token is present (real CI). Keying on CI alone is
// wrong — some environments set CI=true with no token, which makes the reporter
// fail at upload. Local runs still capture; they just don't upload.
const reporter: ReporterDescription[] = [];
if (process.env.ARGOS_TOKEN) {
  reporter.push(["@argos-ci/playwright/reporter"]);
}
reporter.push([process.env.CI ? "github" : "list"]);

// Visual regression for the @repo/ui showcase. Renders the built app in a
// pinned Playwright Docker image in CI (see .github/workflows/visual.yml) so
// the CI render matches the baseline render. Screenshots are uploaded to Argos
// only in CI (the reporter requires ARGOS_TOKEN); locally the specs still run
// and capture, which is enough to validate determinism.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter,
  use: {
    baseURL: `http://localhost:${PORT}`,
    deviceScaleFactor: 1,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
  // Playwright owns start + readiness (native polling) — no hand-rolled
  // `next start &` + wait-on race. `next start` reads NEXT_PUBLIC_STORAGE_URL
  // from .env.local locally / the job env in CI.
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
