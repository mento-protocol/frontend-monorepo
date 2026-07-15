#!/usr/bin/env node

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const GITHUB_DEPLOYMENT_ID_PATTERN = /^[1-9][0-9]*$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const NEXT_DEPLOYMENT_ID_PATTERN = /^m-ui-[0-9a-f]{19}$/;
const AUTOMATIC_KEY_PATTERN =
  /^vercel-preview:v1:pr:[1-9][0-9]*:target:ui:sha:([0-9a-f]{40})$/;
const PILOT_KEY_PATTERN =
  /^vercel-pilot:v1:ui:sha:([0-9a-f]{40}):run:[1-9][0-9]*:attempt:[1-9][0-9]*$/;

function requiredText(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    !pattern.test(value)
  ) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function immutableVercelUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error("Vercel deployment URL is missing or invalid");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Vercel deployment URL must be an immutable HTTPS URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith(".vercel.app") ||
    parsed.hostname === "vercel.app"
  ) {
    throw new Error("Vercel deployment URL must be an immutable HTTPS URL");
  }
  return parsed.toString();
}

export function validateBrowserSmokeInput(values) {
  const commitSha = requiredText(values.commitSha, "Commit SHA", SHA_PATTERN);
  const idempotencyKey = requiredText(
    values.idempotencyKey,
    "Deployment idempotency key",
    /^(?:vercel-preview|vercel-pilot):/,
  );
  const keyMatch =
    AUTOMATIC_KEY_PATTERN.exec(idempotencyKey) ??
    PILOT_KEY_PATTERN.exec(idempotencyKey);
  if (!keyMatch || keyMatch[1] !== commitSha) {
    throw new Error(
      "Deployment idempotency key does not match the exact commit SHA",
    );
  }
  return {
    deploymentUrl: immutableVercelUrl(values.deploymentUrl),
    commitSha,
    idempotencyKey,
    githubDeploymentId: requiredText(
      values.githubDeploymentId,
      "GitHub Deployment ID",
      GITHUB_DEPLOYMENT_ID_PATTERN,
    ),
    vercelDeploymentId: requiredText(
      values.vercelDeploymentId,
      "Vercel Deployment ID",
      VERCEL_DEPLOYMENT_ID_PATTERN,
    ),
    nextDeploymentId: requiredText(
      values.nextDeploymentId,
      "Next.js deployment ID",
      NEXT_DEPLOYMENT_ID_PATTERN,
    ),
  };
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

export function createBrowserFailureMonitor(page, expectedOrigin) {
  const failures = [];

  page.on("pageerror", (error) => {
    failures.push(`page error: ${concise(error?.message ?? error)}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location?.();
    const suffix = location?.url ? ` (${concise(location.url)})` : "";
    failures.push(`console error: ${concise(message.text())}${suffix}`);
  });
  page.on("requestfailed", (request) => {
    if (!sameOrigin(request.url(), expectedOrigin)) return;
    failures.push(
      `same-origin request failed: ${concise(request.method())} ${concise(
        request.url(),
      )} (${concise(request.failure()?.errorText ?? "unknown error")})`,
    );
  });
  page.on("response", (response) => {
    if (
      response.status() < 400 ||
      !sameOrigin(response.url(), expectedOrigin)
    ) {
      return;
    }
    failures.push(
      `same-origin response failed: HTTP ${response.status()} ${concise(
        response.url(),
      )}`,
    );
  });

  return {
    failures,
    assertClean() {
      if (failures.length > 0) {
        throw new Error(
          `Browser smoke observed failures:\n- ${failures.join("\n- ")}`,
        );
      }
    },
  };
}

export async function runBrowserSmoke({ chromium, input, timeoutMs = 30_000 }) {
  const validated = validateBrowserSmokeInput(input);
  const baseUrl = new URL(validated.deploymentUrl);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
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
    const landed = new URL(page.url());
    if (
      landed.origin !== baseUrl.origin ||
      landed.pathname !== "/basic-components"
    ) {
      throw new Error("Browser smoke did not land on Basic Components");
    }
    await page
      .getByRole("heading", { name: "Basic Components", exact: true })
      .waitFor({ state: "visible" });
    const renderedDeploymentId = await page
      .locator("html")
      .getAttribute("data-dpl-id");
    if (renderedDeploymentId !== validated.nextDeploymentId) {
      throw new Error(
        "Browser-rendered page does not carry the expected deployment ID",
      );
    }

    await page
      .getByPlaceholder("Search components...", { exact: true })
      .fill("Textarea");
    await page.getByRole("link", { name: "Textarea", exact: true }).click();
    await page.waitForURL(new URL("/form-components", baseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { name: "Form Components", exact: true })
      .waitFor({ state: "visible" });
    const checkbox = page.getByRole("checkbox", {
      name: "Checkbox option",
      exact: true,
    });
    await checkbox.click();
    if (!(await checkbox.isChecked())) {
      throw new Error("Browser smoke interaction did not update the checkbox");
    }

    // Let errors from hydration and interaction microtasks reach the listeners.
    await page.waitForTimeout(250);
    monitor.assertClean();
    return {
      deploymentUrl: validated.deploymentUrl,
      commitSha: validated.commitSha,
      githubDeploymentId: validated.githubDeploymentId,
      vercelDeploymentId: validated.vercelDeploymentId,
      idempotencyKey: validated.idempotencyKey,
      checkedRoutes: ["/basic-components", "/form-components"],
      interaction: "sidebar-search-and-checkbox",
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

async function runBrowserSmokeFromEnvironment({
  environment = process.env,
  controllerRoot = fileURLToPath(new URL("../../../", import.meta.url)),
  loadChromium = loadTrustedChromium,
} = {}) {
  const result = await runBrowserSmoke({
    chromium: await loadChromium(controllerRoot),
    input: {
      deploymentUrl: environment.VERCEL_DEPLOYMENT_URL,
      commitSha: environment.DEPLOY_SHA,
      idempotencyKey: environment.DEPLOYMENT_IDEMPOTENCY_KEY,
      githubDeploymentId: environment.GITHUB_DEPLOYMENT_ID,
      vercelDeploymentId: environment.VERCEL_DEPLOYMENT_ID,
      nextDeploymentId: environment.MENTO_NEXT_DEPLOYMENT_ID,
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  await runBrowserSmokeFromEnvironment();
}
