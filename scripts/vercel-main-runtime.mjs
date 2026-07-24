#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTrustedChromium } from "./vercel-preview-browser-smoke.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAXIMUM_FAILURES = 100;
const CRITICAL_RESOURCE_TYPES = new Set([
  "document",
  "fetch",
  "font",
  "script",
  "stylesheet",
  "xhr",
]);
const SAME_ORIGIN_ONLY_RESOURCE_TYPES = new Set(["fetch", "xhr"]);
const REQUIRED_RESOURCE_TYPES = ["document", "font", "script", "stylesheet"];

export const MAIN_RUNTIME_TARGETS = Object.freeze({
  app: Object.freeze({
    publicUrl: "https://app.mento.org/",
    landingPath: "/",
    finalPath: "/",
    interaction: "real-production-wallet-list",
  }),
  governance: Object.freeze({
    publicUrl: "https://governance.mento.org/",
    landingPath: "/",
    finalPath: "/voting-power",
    interaction: "governance-voting-power-navigation",
  }),
  reserve: Object.freeze({
    publicUrl: "https://reserve.mento.org/",
    landingPath: "/",
    finalPath: "/",
    interaction: "reserve-overview-data-and-supply-tab",
  }),
  ui: Object.freeze({
    publicUrl: "https://ui.mento.org/",
    landingPath: "/basic-components",
    finalPath: "/form-components",
    interaction: "ui-search-navigation-and-checkbox",
  }),
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedText(value, label, maximum = 2_048) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 31 || codePoint === 127;
      }),
    `${label} is missing or invalid`,
  );
  return value;
}

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

function exactTarget(value) {
  const target = boundedText(value, "Main runtime target", 32);
  invariant(
    Object.hasOwn(MAIN_RUNTIME_TARGETS, target),
    "Main runtime target must be app, governance, reserve, or ui",
  );
  return target;
}

function exactPublicUrl(value, target) {
  const expected = MAIN_RUNTIME_TARGETS[target].publicUrl;
  invariant(value === expected, `${target} public URL mismatch`);
  return expected;
}

function exactSha(value) {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    "Main runtime SHA must be an immutable lowercase 40-character SHA",
  );
  return value;
}

export function validateMainRuntimeInput(values) {
  invariant(
    values !== null && typeof values === "object" && !Array.isArray(values),
    "Main runtime input must be an object",
  );
  const logicalTarget = exactTarget(values.logicalTarget);
  return Object.freeze({
    deploySha: exactSha(values.deploySha),
    logicalTarget,
    publicUrl: exactPublicUrl(values.publicUrl, logicalTarget),
  });
}

export function assertMainRuntimeSecurityHeaders(headers, expectedSha) {
  invariant(
    headers !== null && typeof headers === "object" && !Array.isArray(headers),
    "Main runtime response headers are malformed",
  );
  const required = {
    "content-security-policy": "frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "x-mento-deployment-sha": exactSha(expectedSha),
  };
  for (const [name, expected] of Object.entries(required)) {
    invariant(headers[name] === expected, `Main runtime ${name} mismatch`);
  }
  invariant(
    typeof headers["content-security-policy-report-only"] === "string" &&
      headers["content-security-policy-report-only"].length > 0,
    "Main runtime content-security-policy-report-only is missing",
  );
  return true;
}

function expectedNextNavigationAbort(request, expectedOrigin) {
  try {
    const url = new URL(request.url());
    const resourceType = request.resourceType();
    return (
      url.origin === expectedOrigin &&
      url.searchParams.has("_rsc") &&
      request.failure()?.errorText === "net::ERR_ABORTED" &&
      (resourceType === "fetch" || resourceType === "xhr")
    );
  } catch {
    return false;
  }
}

function isOptionalTelemetryUrl(value, expectedOrigin) {
  try {
    const url = new URL(value);
    return (
      url.origin === expectedOrigin &&
      url.pathname === "/monitoring" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function expectedOptionalTelemetryFailure(request, expectedOrigin) {
  const resourceType = request.resourceType();
  return (
    SAME_ORIGIN_ONLY_RESOURCE_TYPES.has(resourceType) &&
    request.method() === "POST" &&
    isOptionalTelemetryUrl(request.url(), expectedOrigin)
  );
}

function expectedOptionalTelemetryConsoleError(message, expectedOrigin) {
  const location = message.location?.();
  return (
    isOptionalTelemetryUrl(location?.url, expectedOrigin) &&
    /^Failed to load resource: the server responded with a status of [45][0-9]{2} \(\)$/.test(
      message.text(),
    )
  );
}

export function createMainRuntimeMonitor(page, expectedOrigin) {
  const failures = [];
  const successfulResources = {
    document: 0,
    fetch: 0,
    font: 0,
    script: 0,
    stylesheet: 0,
    xhr: 0,
  };
  const record = (message) => {
    if (failures.length < MAXIMUM_FAILURES) failures.push(message);
  };

  page.on("pageerror", (error) => {
    record(`page error: ${concise(error?.message ?? error)}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (expectedOptionalTelemetryConsoleError(message, expectedOrigin)) return;
    const location = message.location?.();
    const suffix = location?.url ? ` (${concise(location.url)})` : "";
    record(`console error: ${concise(message.text())}${suffix}`);
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || frame.url() === "about:blank") return;
    if (!sameOrigin(frame.url(), expectedOrigin)) {
      record(`main frame left expected origin: ${concise(frame.url())}`);
    }
  });
  page.on("requestfailed", (request) => {
    const resourceType = request.resourceType();
    if (!CRITICAL_RESOURCE_TYPES.has(resourceType)) return;
    const requestIsSameOrigin = sameOrigin(request.url(), expectedOrigin);
    if (
      SAME_ORIGIN_ONLY_RESOURCE_TYPES.has(resourceType) &&
      !requestIsSameOrigin
    ) {
      return;
    }
    if (expectedOptionalTelemetryFailure(request, expectedOrigin)) return;
    if (expectedNextNavigationAbort(request, expectedOrigin)) return;
    record(
      `${requestIsSameOrigin ? "same-origin" : "cross-origin"} ${resourceType} request failed: ${concise(
        request.method(),
      )} ${concise(request.url())} (${concise(
        request.failure()?.errorText ?? "unknown error",
      )})`,
    );
  });
  page.on("response", (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (!CRITICAL_RESOURCE_TYPES.has(resourceType)) return;
    const responseIsSameOrigin = sameOrigin(response.url(), expectedOrigin);
    if (
      SAME_ORIGIN_ONLY_RESOURCE_TYPES.has(resourceType) &&
      !responseIsSameOrigin
    ) {
      return;
    }
    if (expectedOptionalTelemetryFailure(request, expectedOrigin)) return;
    if (response.status() >= 400) {
      record(
        `${responseIsSameOrigin ? "same-origin" : "cross-origin"} ${resourceType} response failed: HTTP ${response.status()} ${concise(
          response.url(),
        )}`,
      );
      return;
    }
    if (
      responseIsSameOrigin &&
      response.status() >= 200 &&
      response.status() < 300
    ) {
      successfulResources[resourceType] += 1;
    }
  });

  return {
    failures,
    successfulResources,
    assertClean() {
      if (failures.length > 0) {
        throw new Error(
          `Main runtime smoke observed failures:\n- ${failures.join("\n- ")}`,
        );
      }
      for (const resourceType of REQUIRED_RESOURCE_TYPES) {
        invariant(
          successfulResources[resourceType] > 0,
          `Main runtime smoke observed no successful same-origin ${resourceType}`,
        );
      }
    },
  };
}

export function productionWalletFlagsAreAbsent({
  storage = window.localStorage,
} = {}) {
  return [
    "mento_e2e_wallet",
    "mento_e2e_eager_connect",
    "mento_use_fork",
  ].every((name) => storage.getItem(name) === null);
}

export function reserveSupplyStateMatches({
  currentHref = window.location.href,
  expectedOrigin,
  selectedTabLabel = document
    .querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim(),
}) {
  try {
    const current = new URL(currentHref);
    return (
      current.origin === expectedOrigin &&
      current.pathname === "/" &&
      current.searchParams.size === 1 &&
      current.searchParams.get("tab") === "stablecoins" &&
      selectedTabLabel === "Supply"
    );
  } catch {
    return false;
  }
}

export function uiCheckboxStateMatches({
  checkbox = document.querySelector("#checkbox-demo"),
} = {}) {
  return (
    checkbox?.getAttribute("aria-checked") === "true" &&
    checkbox?.getAttribute("data-state") === "checked"
  );
}

function reserveSupplyState(expectedOrigin) {
  return { expectedOrigin };
}

async function assertProductionWalletFlagsAbsent(page) {
  invariant(
    await page.evaluate(productionWalletFlagsAreAbsent),
    "App public smoke detected preview or mock-wallet browser flags",
  );
}

async function interactWithApp(page) {
  await assertProductionWalletFlagsAbsent(page);
  const connectButton = page
    .getByRole("banner")
    .getByRole("button", { name: "Connect" })
    .filter({ visible: true });
  await connectButton.waitFor({ state: "visible" });
  await connectButton.click();
  await page.getByText("MetaMask").waitFor({ state: "visible" });
  await page.getByText("WalletConnect").waitFor({ state: "visible" });
  invariant(
    (await page.getByText("E2E Test Wallet").count()) === 0,
    "App public smoke rendered the preview-only E2E Test Wallet",
  );
  await assertProductionWalletFlagsAbsent(page);
}

async function interactWithGovernance(page, origin) {
  await page
    .getByRole("heading", { name: "Mento Governance", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByRole("link", { name: "My Voting Power", exact: true })
    .click();
  await page.waitForURL(new URL("/voting-power", origin).toString());
  await page
    .getByRole("heading", { name: "Your voting power", exact: true })
    .waitFor({ state: "visible" });
}

async function interactWithReserve(page, origin) {
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  await overview.waitFor({ state: "visible" });
  invariant(
    (await overview.getAttribute("aria-selected")) === "true",
    "Reserve Overview tab was not initially selected",
  );
  await page
    .getByText("Supply Breakdown", { exact: true })
    .waitFor({ state: "visible" });
  const supply = page.getByRole("tab", { name: "Supply", exact: true });
  await supply.click();
  await page.waitForFunction(
    reserveSupplyStateMatches,
    reserveSupplyState(origin),
  );
  invariant(
    reserveSupplyStateMatches({
      currentHref: page.url(),
      expectedOrigin: origin,
      selectedTabLabel: await supply.textContent(),
    }),
    "Reserve Supply tab state did not persist",
  );
}

async function interactWithUi(page, origin) {
  await page
    .getByRole("heading", { name: "Basic Components", exact: true })
    .waitFor({ state: "visible" });
  await page
    .getByPlaceholder("Search components...", { exact: true })
    .fill("Textarea");
  await page.getByRole("link", { name: "Textarea", exact: true }).click();
  await page.waitForURL(new URL("/form-components", origin).toString(), {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { name: "Form Components", exact: true })
    .waitFor({ state: "visible" });
  const checkbox = page.getByRole("checkbox", {
    name: "Checkbox option",
    exact: true,
  });
  await checkbox.waitFor({ state: "visible" });
  await checkbox.click();
  await page.waitForFunction(uiCheckboxStateMatches);
  invariant(
    await checkbox.isChecked(),
    "UI public smoke checkbox interaction did not update",
  );
}

async function runTargetInteraction(page, target, origin) {
  if (target === "app") return interactWithApp(page);
  if (target === "governance") return interactWithGovernance(page, origin);
  if (target === "reserve") return interactWithReserve(page, origin);
  return interactWithUi(page, origin);
}

function assertExactPageLocation(page, expectedUrl, label) {
  const actual = new URL(page.url());
  invariant(
    actual.origin === expectedUrl.origin &&
      actual.pathname === expectedUrl.pathname &&
      actual.search === expectedUrl.search &&
      actual.hash === "",
    `${label} mismatch`,
  );
}

export async function runMainRuntimeSmoke({
  chromium,
  values,
  timeoutMs = 30_000,
  browserChannel = "bundled",
}) {
  const input = validateMainRuntimeInput(values);
  invariant(
    browserChannel === "bundled" || browserChannel === "chrome",
    "Main runtime browser channel must be bundled or chrome",
  );
  invariant(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs >= 1_000 &&
      timeoutMs <= 120_000,
    "Main runtime browser timeout is outside its bounded policy",
  );
  const config = MAIN_RUNTIME_TARGETS[input.logicalTarget];
  const publicUrl = new URL(input.publicUrl);
  const browser = await chromium.launch({
    ...(browserChannel === "chrome" ? { channel: "chrome" } : {}),
    headless: true,
  });

  try {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    const monitor = createMainRuntimeMonitor(page, publicUrl.origin);
    const response = await page.goto(publicUrl.toString(), {
      waitUntil: "domcontentloaded",
    });
    invariant(
      response && response.ok(),
      `Main runtime navigation failed with HTTP ${response?.status() ?? "unknown"}`,
    );
    assertExactPageLocation(
      page,
      new URL(config.landingPath, publicUrl),
      `${input.logicalTarget} public landing URL`,
    );
    assertMainRuntimeSecurityHeaders(response.headers(), input.deploySha);

    await page.waitForLoadState("load");
    await runTargetInteraction(page, input.logicalTarget, publicUrl.origin);
    await page.waitForTimeout(500);
    const expectedFinalUrl = new URL(config.finalPath, publicUrl);
    if (input.logicalTarget === "reserve") {
      expectedFinalUrl.searchParams.set("tab", "stablecoins");
    }
    assertExactPageLocation(
      page,
      expectedFinalUrl,
      `${input.logicalTarget} public interaction URL`,
    );
    if (input.logicalTarget === "reserve") {
      invariant(
        await page.evaluate(
          reserveSupplyStateMatches,
          reserveSupplyState(publicUrl.origin),
        ),
        "Reserve Supply tab state changed after interaction settle",
      );
    }
    monitor.assertClean();

    return Object.freeze({
      deploy_sha: input.deploySha,
      final_url: expectedFinalUrl.toString(),
      interaction: config.interaction,
      logical_target: input.logicalTarget,
      public_url: input.publicUrl,
      successful_documents: monitor.successfulResources.document,
      successful_fonts: monitor.successfulResources.font,
      successful_scripts: monitor.successfulResources.script,
      successful_stylesheets: monitor.successfulResources.stylesheet,
    });
  } finally {
    await browser.close();
  }
}

function valuesFromEnvironment(environment) {
  return {
    deploySha: environment.DEPLOY_SHA,
    logicalTarget: environment.LOGICAL_TARGET,
    publicUrl: environment.PUBLIC_URL,
  };
}

function appendOutputs(path, result) {
  for (const [name, value] of Object.entries(result)) {
    appendFileSync(path, `${name}=${value}\n`);
  }
}

export function formatMainRuntimeSummary(result) {
  return [
    `### ${result.logical_target} public runtime verification`,
    "",
    `- Public URL: ${result.public_url}`,
    `- Final URL: ${result.final_url}`,
    `- DEPLOY_SHA: \`${result.deploy_sha}\``,
    `- Interaction: \`${result.interaction}\``,
    `- Successful same-origin resources: documents=${result.successful_documents}, scripts=${result.successful_scripts}, stylesheets=${result.successful_stylesheets}, fonts=${result.successful_fonts}`,
    "",
  ].join("\n");
}

export async function runMainRuntimeSmokeFromEnvironment({
  environment = process.env,
  controllerRoot = fileURLToPath(new URL("../", import.meta.url)),
  chromium,
} = {}) {
  const result = await runMainRuntimeSmoke({
    chromium: chromium ?? (await loadTrustedChromium(controllerRoot)),
    values: valuesFromEnvironment(environment),
    browserChannel: environment.PLAYWRIGHT_BROWSER_CHANNEL ?? "bundled",
  });
  if (environment.GITHUB_OUTPUT) {
    appendOutputs(
      boundedText(environment.GITHUB_OUTPUT, "GITHUB_OUTPUT", 4_096),
      result,
    );
  }
  if (environment.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      boundedText(
        environment.GITHUB_STEP_SUMMARY,
        "GITHUB_STEP_SUMMARY",
        4_096,
      ),
      formatMainRuntimeSummary(result),
    );
  }
  return result;
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  if (process.argv.length !== 2) {
    throw new Error("Usage: vercel-main-runtime.mjs");
  }
  const result = await runMainRuntimeSmokeFromEnvironment();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
