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
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: `next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
