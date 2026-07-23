/* eslint-disable turbo/no-undeclared-env-vars -- The direct Actions smoke does not run through Turbo. */

import { expect, test, type Page, type Response } from "@playwright/test";

import {
  assertProductionShadowOrigin,
  fulfillProductionShadowRequest,
} from "./request-policy.mjs";
import {
  assertProductionShadowHydratedIdentity,
  assertProductionShadowServerIdentity,
} from "./deployment-identity.mjs";
import {
  createBrowserDeploymentIdentityMonitor,
  readSettledBrowserDeploymentIdentity,
} from "../../../ui.mento.org/e2e/vercel-preview-browser-smoke.mjs";

const TARGETS = ["governance", "reserve", "ui"] as const;
type Target = (typeof TARGETS)[number];

interface RuntimeErrors {
  console: string[];
  origins: string[];
  page: string[];
  requests: string[];
  responses: string[];
}

function requiredInputs() {
  const target = process.env.PRODUCTION_SHADOW_TARGET;
  const url = process.env.PRODUCTION_SHADOW_URL;
  const expectedDeploymentId =
    process.env.PRODUCTION_SHADOW_EXPECTED_DEPLOYMENT_ID;
  const expectedSha = process.env.PRODUCTION_SHADOW_EXPECTED_SHA;
  if (!TARGETS.includes(target as Target)) {
    throw new Error(
      "PRODUCTION_SHADOW_TARGET must be governance, reserve, or ui",
    );
  }
  if (!url) throw new Error("PRODUCTION_SHADOW_URL is required");
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname.endsWith(".vercel.app") ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(
      "PRODUCTION_SHADOW_URL must be an immutable HTTPS Vercel URL",
    );
  }
  if (
    !expectedDeploymentId ||
    !new RegExp(`^m-${target}-[a-f0-9]{19}$`).test(expectedDeploymentId)
  ) {
    throw new Error(
      "PRODUCTION_SHADOW_EXPECTED_DEPLOYMENT_ID must match the exact target build ID",
    );
  }
  if (!expectedSha || !/^[a-f0-9]{40}$/.test(expectedSha)) {
    throw new Error(
      "PRODUCTION_SHADOW_EXPECTED_SHA must be the exact lowercase deployment SHA",
    );
  }
  return {
    target: target as Target,
    url: parsedUrl,
    expectedDeploymentId,
    expectedSha,
  };
}

function observeRuntimeErrors(page: Page, origin: string): RuntimeErrors {
  const errors: RuntimeErrors = {
    console: [],
    origins: [],
    page: [],
    requests: [],
    responses: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || frame.url() === "about:blank") return;
    try {
      assertProductionShadowOrigin(frame.url(), origin);
    } catch {
      errors.origins.push(frame.url());
    }
  });
  page.on("requestfailed", (request) => {
    const resourceType = request.resourceType();
    if (["document", "script", "stylesheet"].includes(resourceType)) {
      errors.requests.push(
        `${resourceType} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
      );
    }
  });
  page.on("response", (response) => {
    const resourceType = response.request().resourceType();
    if (
      ["document", "script", "stylesheet"].includes(resourceType) &&
      response.status() >= 400
    ) {
      errors.responses.push(
        `${resourceType} ${response.url()} HTTP ${response.status()}`,
      );
    }
  });
  return errors;
}

function assertSecurityHeaders(response: Response) {
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
  expect(headers["content-security-policy-report-only"]).toBeTruthy();
}

async function verifyTarget(page: Page, target: Target, origin: string) {
  if (target === "governance") {
    await expect(
      page.getByRole("heading", { name: "Mento Governance" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "My Voting Power" }).click();
    await expect(page).toHaveURL(/\/voting-power$/);
    expect(() =>
      assertProductionShadowOrigin(page.url(), origin),
    ).not.toThrow();
    return;
  }
  if (target === "reserve") {
    await expect(page.getByText("Mento Reserve").first()).toBeVisible({
      timeout: 30_000,
    });
    const supplyTab = page.getByRole("tab", { name: "Supply" });
    await supplyTab.click();
    await expect(supplyTab).toHaveAttribute("data-state", "active");
    await expect(page).toHaveURL(/[?&]tab=stablecoins(?:&|$)/);
    expect(() =>
      assertProductionShadowOrigin(page.url(), origin),
    ).not.toThrow();
    return;
  }

  await expect(
    page.getByRole("heading", { name: "Basic Components" }),
  ).toBeVisible({ timeout: 30_000 });
  const search = page.getByPlaceholder("Search components...");
  await search.fill("Dialog");
  await expect(
    page.getByRole("button", { name: /Interactive Components/ }),
  ).toBeVisible();
  expect(() => assertProductionShadowOrigin(page.url(), origin)).not.toThrow();
}

async function assertHydratedDeploymentIdentity({
  page,
  target,
  expectedDeploymentId,
  expectedOrigin,
  deploymentIdentityMonitor,
}: {
  page: Page;
  target: Target;
  expectedDeploymentId: string;
  expectedOrigin: string;
  deploymentIdentityMonitor: ReturnType<
    typeof createBrowserDeploymentIdentityMonitor
  >;
}) {
  if (!deploymentIdentityMonitor) {
    throw new Error(`${target} deployment identity monitor is required`);
  }
  const { htmlDeploymentId: renderedDeploymentId, assetReferences } =
    await readSettledBrowserDeploymentIdentity({
      page,
      monitor: deploymentIdentityMonitor,
      expectedDeploymentId,
      timeoutMs: 30_000,
    });
  assertProductionShadowHydratedIdentity({
    target,
    expectedDeploymentId,
    renderedDeploymentId,
    assetReferences,
    expectedOrigin,
  });
}

test("staged production artifact is healthy, secure, and interactive", async ({
  page,
}) => {
  const { target, url, expectedDeploymentId, expectedSha } = requiredInputs();
  const deploymentIdentityMonitor = createBrowserDeploymentIdentityMonitor(
    page,
    url.origin,
  );
  await page.route("**/*", async (route) => {
    await fulfillProductionShadowRequest({ route });
  });
  const errors = observeRuntimeErrors(page, url.origin);
  const response = await page.goto("/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  expect(response, "document response must exist").not.toBeNull();
  expect(response?.status()).toBeGreaterThanOrEqual(200);
  expect(response?.status()).toBeLessThan(300);
  expect(() =>
    assertProductionShadowOrigin(page.url(), url.origin),
  ).not.toThrow();
  assertSecurityHeaders(response as Response);
  expect(response?.headers()["x-mento-deployment-sha"]).toBe(expectedSha);
  assertProductionShadowServerIdentity(
    await (response as Response).text(),
    expectedDeploymentId,
  );

  // Target controls are server rendered. Wait for deferred client scripts so
  // the first interaction cannot race React hydration.
  await page.waitForLoadState("load");
  await assertHydratedDeploymentIdentity({
    page,
    target,
    expectedDeploymentId,
    expectedOrigin: url.origin,
    deploymentIdentityMonitor,
  });
  await verifyTarget(page, target, url.origin);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {
    // Live data polling may keep the network active. The tracked document,
    // script, stylesheet, page, and console failures remain authoritative.
  });
  await assertHydratedDeploymentIdentity({
    page,
    target,
    expectedDeploymentId,
    expectedOrigin: url.origin,
    deploymentIdentityMonitor,
  });

  expect(errors.origins, "cross-origin main-frame navigations").toEqual([]);
  expect(errors.page, "uncaught page errors").toEqual([]);
  expect(
    errors.console,
    "console errors (reviewed allowlist is empty)",
  ).toEqual([]);
  expect(errors.requests, "failed critical requests from any origin").toEqual(
    [],
  );
  expect(errors.responses, "critical HTTP failures from any origin").toEqual(
    [],
  );
});
