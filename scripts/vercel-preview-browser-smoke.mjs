#!/usr/bin/env node

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validatePreviewSmokeTuple } from "./vercel-preview-smoke.mjs";

const MAXIMUM_FAILURES = 100;

function concise(value) {
  return String(value).replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function sameOrigin(value, expectedOrigin) {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function expectedNextNavigationAbort(request, expectedOrigin) {
  try {
    const url = new URL(request.url());
    return (
      url.origin === expectedOrigin &&
      url.searchParams.has("_rsc") &&
      request.failure()?.errorText === "net::ERR_ABORTED" &&
      (!request.resourceType ||
        request.resourceType() === "fetch" ||
        request.resourceType() === "xhr")
    );
  } catch {
    return false;
  }
}

export function createBrowserFailureMonitor(page, expectedOrigin) {
  const failures = [];
  const assets = { scripts: 0, styles: 0, fonts: 0 };
  const record = (message) => {
    if (failures.length < MAXIMUM_FAILURES) failures.push(message);
  };

  page.on("pageerror", (error) => {
    record(`page error: ${concise(error?.message ?? error)}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location?.();
    const suffix = location?.url ? ` (${concise(location.url)})` : "";
    record(`console error: ${concise(message.text())}${suffix}`);
  });
  page.on("requestfailed", (request) => {
    if (!sameOrigin(request.url(), expectedOrigin)) return;
    // Next's App Router intentionally aborts a superseded RSC navigation or
    // prefetch. Static assets and every other same-origin failure still fail.
    if (expectedNextNavigationAbort(request, expectedOrigin)) return;
    record(
      `same-origin request failed: ${concise(request.method())} ${concise(
        request.url(),
      )} (${concise(request.failure()?.errorText ?? "unknown error")})`,
    );
  });
  page.on("response", (response) => {
    if (!sameOrigin(response.url(), expectedOrigin)) return;
    if (response.status() >= 400) {
      record(
        `same-origin response failed: HTTP ${response.status()} ${concise(
          response.url(),
        )}`,
      );
      return;
    }
    if (response.status() >= 200 && response.status() < 300) {
      const pathname = new URL(response.url()).pathname;
      if (pathname.endsWith(".js")) assets.scripts += 1;
      if (pathname.endsWith(".css")) assets.styles += 1;
      if (/\.(?:woff2?|ttf)$/.test(pathname)) assets.fonts += 1;
    }
  });

  return {
    assets,
    assertClean() {
      if (failures.length > 0) {
        throw new Error(
          `Browser smoke observed failures:\n- ${failures.join("\n- ")}`,
        );
      }
      for (const [kind, count] of Object.entries(assets)) {
        if (count === 0)
          throw new Error(`Browser smoke observed no successful ${kind}`);
      }
    },
  };
}

function requireSecurityHeaders(response) {
  const headers = response.headers();
  if (headers["content-security-policy"] !== "frame-ancestors 'none'") {
    throw new Error("Preview response has an invalid content-security-policy");
  }
  if (headers["x-frame-options"] !== "DENY") {
    throw new Error("Preview response has an invalid x-frame-options");
  }
  if (headers["x-content-type-options"] !== "nosniff") {
    throw new Error("Preview response has an invalid x-content-type-options");
  }
}

export function reserveTabStateMatches({
  currentHref = window.location.href,
  expectedOrigin,
  expectedTabLabel,
  expectedTabValue,
  selectedTabLabel = document
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim(),
}) {
  try {
    const currentUrl = new URL(currentHref);
    return (
      currentUrl.origin === expectedOrigin &&
      currentUrl.searchParams.get("tab") === expectedTabValue &&
      selectedTabLabel === expectedTabLabel
    );
  } catch {
    return false;
  }
}

async function runTargetInteraction(page, target, deploymentUrl) {
  if (target === "reserve") {
    const overview = page.getByRole("tab", { name: "Overview", exact: true });
    await overview.waitFor({ state: "visible" });
    if ((await overview.getAttribute("aria-selected")) !== "true") {
      throw new Error("Reserve Overview tab was not initially selected");
    }
    await page
      .getByText("Supply Breakdown", { exact: true })
      .waitFor({ state: "visible" });
    const supply = page.getByRole("tab", { name: "Supply", exact: true });
    await supply.click();
    await page.waitForFunction(reserveTabStateMatches, {
      expectedOrigin: deploymentUrl.origin,
      expectedTabLabel: "Supply",
      expectedTabValue: "stablecoins",
    });
    if (new URL(page.url()).searchParams.get("tab") !== "stablecoins") {
      throw new Error("Reserve Supply tab URL state did not persist");
    }
    if ((await supply.getAttribute("aria-selected")) !== "true") {
      throw new Error("Reserve Supply tab did not become selected");
    }
    return "overview-data-and-supply-tab";
  }
  await page.locator("body").waitFor({ state: "visible" });
  return "wallet-flow-runs-in-the-target-specific-suite";
}

export async function runBrowserSmoke({
  chromium,
  values,
  timeoutMs = 30_000,
  browserChannel = "bundled",
}) {
  const tuple = validatePreviewSmokeTuple(values);
  if (tuple.logicalTarget === "ui") {
    throw new Error("UI must use its deployment-identity browser smoke");
  }
  if (browserChannel !== "chrome" && browserChannel !== "bundled") {
    throw new Error("Browser smoke channel is invalid");
  }
  const baseUrl = new URL(tuple.deploymentUrl);
  const browser = await chromium.launch({
    ...(browserChannel === "chrome" ? { channel: "chrome" } : {}),
    headless: true,
  });
  try {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    const monitor = createBrowserFailureMonitor(page, baseUrl.origin);
    const response = await page.goto(baseUrl.toString(), {
      waitUntil: "domcontentloaded",
    });
    if (!response || !response.ok()) {
      throw new Error(
        `Browser navigation failed with HTTP ${response?.status() ?? "unknown"}`,
      );
    }
    if (new URL(page.url()).origin !== baseUrl.origin) {
      throw new Error("Browser smoke escaped the immutable preview origin");
    }
    requireSecurityHeaders(response);
    // The tab shell is server rendered. Wait for all deferred client scripts
    // before clicking so the first interaction cannot race React hydration.
    await page.waitForLoadState("load");
    const interaction = await runTargetInteraction(
      page,
      tuple.logicalTarget,
      baseUrl,
    );
    await page.waitForTimeout(250);
    if (new URL(page.url()).origin !== baseUrl.origin) {
      throw new Error(
        "Browser smoke escaped the immutable preview origin after interaction",
      );
    }
    monitor.assertClean();
    return {
      logicalTarget: tuple.logicalTarget,
      deploymentUrl: tuple.deploymentUrl,
      commitSha: tuple.commitSha,
      githubDeploymentId: tuple.githubDeploymentId,
      interaction,
      assets: monitor.assets,
    };
  } finally {
    await browser.close();
  }
}

export async function loadTrustedChromium(controllerRoot) {
  const require = createRequire(
    join(controllerRoot, "apps/ui.mento.org/package.json"),
  );
  const playwright = require("@playwright/test");
  if (!playwright?.chromium) {
    throw new Error("Trusted Playwright chromium dependency is unavailable");
  }
  return playwright.chromium;
}

function valuesFromEnvironment(environment = process.env) {
  return {
    logicalTarget: environment.LOGICAL_TARGET,
    deploymentUrl: environment.VERCEL_DEPLOYMENT_URL,
    commitSha: environment.DEPLOY_SHA,
    pullRequestNumber: environment.PULL_REQUEST_NUMBER,
    githubDeploymentId: environment.GITHUB_DEPLOYMENT_ID,
    verificationMode: environment.VERIFICATION_MODE,
    verificationKey: environment.VERIFICATION_KEY,
    workflowRunId: environment.WORKFLOW_RUN_ID,
    workflowRunAttempt: environment.WORKFLOW_RUN_ATTEMPT,
    vercelDeploymentId: environment.VERCEL_DEPLOYMENT_ID,
    nextDeploymentId: environment.MENTO_NEXT_DEPLOYMENT_ID,
    expectedProjectId: environment.EXPECTED_PROJECT_ID,
    metadataLogicalTarget: environment.METADATA_LOGICAL_TARGET,
    metadataProjectId: environment.METADATA_PROJECT_ID,
    metadataTarget: environment.METADATA_TARGET,
    metadataRepository: environment.METADATA_REPOSITORY,
    metadataRef: environment.METADATA_REF,
    metadataSha: environment.METADATA_SHA,
    metadataUrl: environment.METADATA_URL,
    metadataEnvironment: environment.METADATA_ENVIRONMENT,
    metadataActorLogin: environment.METADATA_ACTOR_LOGIN,
    metadataActorId: environment.METADATA_ACTOR_ID,
    metadataActorType: environment.METADATA_ACTOR_TYPE,
  };
}

async function runFromEnvironment({
  environment = process.env,
  controllerRoot = fileURLToPath(new URL("../", import.meta.url)),
} = {}) {
  const result = await runBrowserSmoke({
    chromium: await loadTrustedChromium(controllerRoot),
    values: valuesFromEnvironment(environment),
    browserChannel: environment.PLAYWRIGHT_BROWSER_CHANNEL ?? "bundled",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) await runFromEnvironment();
