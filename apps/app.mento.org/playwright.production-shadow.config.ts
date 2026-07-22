/* eslint-disable turbo/no-undeclared-env-vars -- The direct Actions smoke does not run through Turbo. */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/production-shadow",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  outputDir: process.env.PRODUCTION_SHADOW_OUTPUT_DIR ?? "test-results",
  reporter: [[process.env.CI ? "github" : "list"]],
  use: {
    baseURL: process.env.PRODUCTION_SHADOW_URL,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    // Traces capture request headers, including a deployment-protection
    // bypass when configured. Keep only visual diagnostics safe to upload.
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "production-shadow" }],
});
