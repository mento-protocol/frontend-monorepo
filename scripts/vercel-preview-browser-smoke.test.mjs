import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  createBrowserFailureMonitor,
  loadTrustedChromium,
  reserveTabStateMatches,
  runBrowserSmoke,
} from "./vercel-preview-browser-smoke.mjs";

const repoRoot = new URL("../", import.meta.url).pathname;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const CUSTOM_ID_GENERIC_TARGETS = ["governance", "reserve"];

function controllerTuple(target) {
  const hostname = {
    app: "appmento",
    governance: "governancemento",
    reserve: "reservemento",
  }[target];
  const deploymentUrl = `https://${hostname}-abc123-mentolabs.vercel.app/`;
  return {
    logicalTarget: target,
    deploymentUrl,
    commitSha: SHA,
    pullRequestNumber: "520",
    githubDeploymentId: "1234",
    verificationMode: "controller",
    verificationKey: `vercel-preview:v1:pr:520:target:${target}:sha:${SHA}`,
    vercelDeploymentId: "dpl_Abc123",
    nextDeploymentId: `m-${target}-0123456789abcdef012`,
    expectedProjectId: `prj_${target}`,
    metadataLogicalTarget: target,
    metadataProjectId: `prj_${target}`,
    metadataTarget: "preview",
    metadataRepository: "mento-protocol/frontend-monorepo",
    metadataRef: "feature/multi-app-preview",
    metadataSha: SHA,
    metadataUrl: deploymentUrl,
    metadataEnvironment: "",
    metadataActorLogin: "",
    metadataActorId: "",
    metadataActorType: "",
  };
}

class FakePage extends EventEmitter {
  constructor(
    values,
    {
      afterInteraction,
      assetRequests,
      competingNavigation = false,
      htmlDeploymentId = values.nextDeploymentId,
      onHtmlDeploymentIdRead,
    } = {},
  ) {
    super();
    this.values = values;
    this.afterInteraction = afterInteraction;
    this.assetRequests = assetRequests;
    this.competingNavigation = competingNavigation;
    this.htmlDeploymentId = htmlDeploymentId;
    this.onHtmlDeploymentIdRead = onHtmlDeploymentIdRead;
    this.htmlDeploymentIdReads = 0;
    this.currentUrl = values.deploymentUrl;
    this.loadComplete = false;
    this.supplySelected = false;
    this.calls = [];
  }

  setDefaultTimeout(timeout) {
    this.calls.push(["timeout", timeout]);
  }

  setDefaultNavigationTimeout(timeout) {
    this.calls.push(["navigation-timeout", timeout]);
  }

  async goto(url, options) {
    this.calls.push(["goto", url, options]);
    const assetRequests = this.assetRequests ?? [
      {
        path: `/_next/static/app.js?dpl=${this.values.nextDeploymentId}`,
        resourceType: "script",
      },
      {
        path: `/_next/static/app.css?dpl=${this.values.nextDeploymentId}`,
        resourceType: "stylesheet",
      },
      {
        path: `/_next/static/font.woff2?dpl=${this.values.nextDeploymentId}`,
        resourceType: "font",
      },
    ];
    for (const request of assetRequests) {
      this.emitAssetRequest(new URL(request.path, url).toString(), request);
    }
    return {
      ok: () => true,
      status: () => 200,
      headers: () => ({
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
      }),
    };
  }

  emitAssetRequest(
    reference,
    { redirectedFrom = null, resourceType = "script" } = {},
  ) {
    const request = this.startAssetRequest(reference, {
      redirectedFrom,
      resourceType,
    });
    this.finishAssetRequest(request);
    return request;
  }

  startAssetRequest(
    reference,
    { redirectedFrom = null, resourceType = "script" } = {},
  ) {
    const request = {
      failure: () => ({ errorText: "net::ERR_FAILED" }),
      method: () => "GET",
      redirectedFrom: () => redirectedFrom,
      resourceType: () => resourceType,
      url: () => reference,
    };
    this.emit("request", request);
    this.emit("response", {
      request: () => request,
      url: () => reference,
      status: () => 200,
    });
    return request;
  }

  finishAssetRequest(request) {
    this.emit("requestfinished", request);
  }

  url() {
    return this.currentUrl;
  }

  locator(selector) {
    if (selector === "html") {
      return {
        getAttribute: async (attribute) => {
          assert.equal(attribute, "data-dpl-id");
          this.htmlDeploymentIdReads += 1;
          this.onHtmlDeploymentIdRead?.(this, this.htmlDeploymentIdReads);
          return this.htmlDeploymentId;
        },
      };
    }
    assert.equal(selector, "body");
    return {
      waitFor: async (options) => {
        this.calls.push(["body", options]);
      },
    };
  }

  getByText(text, options) {
    assert.equal(text, "Supply Breakdown");
    assert.deepEqual(options, { exact: true });
    return {
      waitFor: async (waitOptions) => {
        this.calls.push(["supply-data", waitOptions]);
      },
    };
  }

  getByRole(role, options) {
    assert.equal(role, "tab");
    if (options.name === "Overview") {
      return {
        waitFor: async (waitOptions) => {
          this.calls.push(["overview", waitOptions]);
        },
        getAttribute: async (attribute) => {
          assert.equal(attribute, "aria-selected");
          return "true";
        },
      };
    }
    if (options.name === "Supply") {
      return {
        click: async () => {
          if (!this.loadComplete) {
            this.calls.push(["supply-click-before-load"]);
            return;
          }
          this.supplySelected = true;
          this.pendingSupplyUrl = new URL(
            "/?tab=stablecoins",
            this.values.deploymentUrl,
          ).toString();
          if (!this.competingNavigation) {
            this.currentUrl = this.pendingSupplyUrl;
          }
          this.calls.push(["supply-click"]);
        },
        getAttribute: async (attribute) => {
          assert.equal(attribute, "aria-selected");
          return this.supplySelected ? "true" : "false";
        },
      };
    }
    throw new Error(`Unexpected role ${options.name}`);
  }

  async waitForFunction(predicate, argument) {
    this.assertSupplyTabArgument(argument);
    assert.equal(this.supplySelected, true);
    const stateMatches = () => this.supplyTabStateMatches(predicate, argument);
    if (this.competingNavigation) {
      assert.equal(stateMatches(), false);
      this.calls.push(["competing-navigation", this.currentUrl]);
      this.currentUrl = this.pendingSupplyUrl;
    }
    assert.equal(stateMatches(), true);
    this.calls.push(["wait-for-function", this.currentUrl]);
  }

  assertSupplyTabArgument(argument) {
    assert.deepEqual(argument, {
      expectedOrigin: new URL(this.values.deploymentUrl).origin,
      expectedTabLabel: "Supply",
      expectedTabValue: "stablecoins",
    });
  }

  supplyTabStateMatches(predicate, argument) {
    return predicate({
      ...argument,
      currentHref: this.currentUrl,
      selectedTabLabel: this.supplySelected ? "Supply" : "Overview",
    });
  }

  async evaluate(predicate, argument) {
    this.assertSupplyTabArgument(argument);
    this.calls.push(["evaluate-supply-state", this.currentUrl]);
    return this.supplyTabStateMatches(predicate, argument);
  }

  async waitForLoadState(state) {
    assert.equal(state, "load");
    this.loadComplete = true;
    this.calls.push(["load"]);
  }

  async waitForTimeout(timeout) {
    this.calls.push(["settle", timeout]);
    this.afterInteraction?.(this);
  }
}

function fakeChromium(page) {
  const state = { launchOptions: null, contextOptions: null, closed: false };
  return {
    state,
    chromium: {
      async launch(options) {
        state.launchOptions = options;
        return {
          async newContext(contextOptions) {
            state.contextOptions = contextOptions;
            return { newPage: async () => page };
          },
          async close() {
            state.closed = true;
          },
        };
      },
    },
  };
}

test("Reserve browser smoke renders runtime data and changes the Supply tab state", async () => {
  const values = controllerTuple("reserve");
  const page = new FakePage(values);
  const fake = fakeChromium(page);
  const result = await runBrowserSmoke({ chromium: fake.chromium, values });

  assert.deepEqual(fake.state.launchOptions, { headless: true });
  assert.deepEqual(fake.state.contextOptions, { colorScheme: "dark" });
  assert.equal(fake.state.closed, true);
  assert.equal(result.interaction, "overview-data-and-supply-tab");
  assert.equal(page.supplySelected, true);
  assert.ok(page.calls.some(([name]) => name === "supply-data"));
  assert.ok(
    page.calls.findIndex(([name]) => name === "load") <
      page.calls.findIndex(([name]) => name === "supply-click"),
  );
});

test("Reserve browser smoke does not latch onto a competing root navigation", async () => {
  const values = controllerTuple("reserve");
  const page = new FakePage(values, { competingNavigation: true });
  const result = await runBrowserSmoke({
    chromium: fakeChromium(page).chromium,
    values,
  });

  assert.equal(result.interaction, "overview-data-and-supply-tab");
  assert.ok(page.calls.some(([name]) => name === "competing-navigation"));
  assert.ok(page.calls.some(([name]) => name === "wait-for-function"));
  assert.equal(new URL(page.url()).searchParams.get("tab"), "stablecoins");
});

test("Reserve browser smoke rejects a late same-origin return to Overview", async () => {
  const values = controllerTuple("reserve");
  const page = new FakePage(values, {
    afterInteraction: (currentPage) => {
      currentPage.currentUrl = values.deploymentUrl;
      currentPage.supplySelected = false;
      currentPage.calls.push(["late-overview-navigation"]);
    },
  });
  const fake = fakeChromium(page);

  await assert.rejects(
    runBrowserSmoke({ chromium: fake.chromium, values }),
    /Reserve Supply tab state did not persist after interaction settle/,
  );
  assert.equal(fake.state.closed, true);
  assert.ok(page.calls.some(([name]) => name === "late-overview-navigation"));
  assert.ok(page.calls.some(([name]) => name === "evaluate-supply-state"));
});

test("Reserve tab matcher binds the immutable origin, URL state, and selected tab", () => {
  const expectedOrigin = "https://reservemento-abc123-mentolabs.vercel.app";
  const validState = {
    currentHref: `${expectedOrigin}/?tab=stablecoins`,
    expectedOrigin,
    expectedTabLabel: "Supply",
    expectedTabValue: "stablecoins",
    selectedTabLabel: "Supply",
  };

  assert.equal(reserveTabStateMatches(validState), true);
  for (const invalidState of [
    { currentHref: "https://example.com/?tab=stablecoins" },
    { currentHref: `${expectedOrigin}/?tab=collateral` },
    { currentHref: "not a URL" },
    { selectedTabLabel: "Overview" },
    { selectedTabLabel: null },
  ]) {
    assert.equal(
      reserveTabStateMatches({ ...validState, ...invalidState }),
      false,
    );
  }
});

test("App browser smoke uses system Chrome when explicitly requested", async () => {
  const values = controllerTuple("app");
  const page = new FakePage(values);
  const fake = fakeChromium(page);
  const result = await runBrowserSmoke({
    chromium: fake.chromium,
    values,
    browserChannel: "chrome",
  });

  assert.deepEqual(fake.state.launchOptions, {
    channel: "chrome",
    headless: true,
  });
  assert.equal(
    result.interaction,
    "wallet-flow-runs-in-the-target-specific-suite",
  );
  assert.ok(page.calls.some(([name]) => name === "body"));
});

test("custom-ID Governance and Reserve accept exact typed assets after hydration removes the marker", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const page = new FakePage(values, { htmlDeploymentId: null });
    const fake = fakeChromium(page);

    const result = await runBrowserSmoke({
      chromium: fake.chromium,
      values,
    });

    assert.equal(result.logicalTarget, target);
    assert.equal(fake.state.closed, true);
  }
});

test("custom-ID Governance and Reserve reject conflicting hydrated markers", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const fake = fakeChromium(
      new FakePage(values, {
        htmlDeploymentId: `m-${target}-${"f".repeat(19)}`,
      }),
    );

    await assert.rejects(
      runBrowserSmoke({ chromium: fake.chromium, values }),
      /conflicting deployment ID/,
    );
    assert.equal(fake.state.closed, true);
  }
});

test("custom-ID Governance and Reserve reject wrong, missing, or duplicate asset deployment IDs", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const invalidJavaScriptPaths = [
      `/_next/static/app.js?dpl=m-${target}-${"f".repeat(19)}`,
      "/_next/static/app.js",
      `/_next/static/app.js?dpl=${values.nextDeploymentId}&dpl=${values.nextDeploymentId}`,
    ];
    for (const path of invalidJavaScriptPaths) {
      const fake = fakeChromium(
        new FakePage(values, {
          htmlDeploymentId: null,
          assetRequests: [
            { path, resourceType: "script" },
            {
              path: `/_next/static/app.css?dpl=${values.nextDeploymentId}`,
              resourceType: "stylesheet",
            },
          ],
        }),
      );

      await assert.rejects(
        runBrowserSmoke({ chromium: fake.chromium, values }),
        /do not carry only the expected deployment ID/,
      );
      assert.equal(fake.state.closed, true);
    }
  }
});

test("custom-ID Governance and Reserve reject resource-type suffix spoofs", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const fake = fakeChromium(
      new FakePage(values, {
        htmlDeploymentId: null,
        assetRequests: [
          {
            path: `/_next/static/app.js?dpl=${values.nextDeploymentId}`,
            resourceType: "fetch",
          },
          {
            path: `/_next/static/app.css?dpl=${values.nextDeploymentId}`,
            resourceType: "image",
          },
        ],
      }),
    );

    await assert.rejects(
      runBrowserSmoke({ chromium: fake.chromium, values }),
      /request types are missing or invalid/,
    );
    assert.equal(fake.state.closed, true);
  }
});

test("custom-ID Governance and Reserve reject late static asset redirects outside the immutable origin", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const page = new FakePage(values, {
      htmlDeploymentId: null,
      afterInteraction(currentPage) {
        const original = currentPage.emitAssetRequest(
          new URL(
            `/_next/static/late.js?dpl=${values.nextDeploymentId}`,
            values.deploymentUrl,
          ).toString(),
        );
        currentPage.emitAssetRequest("https://assets.example.invalid/late.js", {
          redirectedFrom: original,
        });
      },
    });
    const fake = fakeChromium(page);

    await assert.rejects(
      runBrowserSmoke({ chromium: fake.chromium, values }),
      /redirected outside its immutable identity/,
    );
    assert.equal(fake.state.closed, true);
  }
});

test("custom-ID Governance and Reserve settle requests started during the hydrated marker read", async () => {
  for (const target of CUSTOM_ID_GENERIC_TARGETS) {
    const values = controllerTuple(target);
    const page = new FakePage(values, {
      htmlDeploymentId: null,
      onHtmlDeploymentIdRead(currentPage, readCount) {
        if (readCount !== 1) return;
        const request = currentPage.startAssetRequest(
          new URL(
            `/_next/static/late.js?dpl=${values.nextDeploymentId}`,
            values.deploymentUrl,
          ).toString(),
        );
        setTimeout(() => {
          currentPage.calls.push(["race-asset-finished"]);
          currentPage.finishAssetRequest(request);
        }, 10);
      },
    });
    const fake = fakeChromium(page);

    await runBrowserSmoke({ chromium: fake.chromium, values });

    const requestFinishedIndex = page.calls.findIndex(
      ([name]) => name === "race-asset-finished",
    );
    const interactionIndex = page.calls.findIndex(([name]) =>
      target === "reserve" ? name === "supply-click" : name === "body",
    );
    assert.ok(requestFinishedIndex >= 0);
    assert.ok(interactionIndex > requestFinishedIndex);
    assert.equal(fake.state.closed, true);
  }
});

test("browser failure monitor fails on console, page, and same-origin asset errors", () => {
  const origin = "https://appmento-abc123-mentolabs.vercel.app";
  const page = new EventEmitter();
  const monitor = createBrowserFailureMonitor(page, origin);
  page.emit("console", {
    type: () => "error",
    text: () => "hydration failed",
    location: () => ({ url: `${origin}/_next/static/app.js` }),
  });
  page.emit("pageerror", new Error("render exploded"));
  page.emit("requestfailed", {
    url: () => `${origin}/_next/static/app.js`,
    method: () => "GET",
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  });
  assert.throws(() => monitor.assertClean(), /hydration failed/);
});

test("browser failure monitor ignores only Next's expected superseded RSC abort", () => {
  const origin = "https://reservemento-abc123-mentolabs.vercel.app";
  const page = new EventEmitter();
  const monitor = createBrowserFailureMonitor(page, origin);
  for (const path of [
    "/_next/static/app.js",
    "/_next/static/app.css",
    "/_next/static/font.woff2",
  ]) {
    page.emit("response", {
      url: () => new URL(path, origin).toString(),
      status: () => 200,
    });
  }
  page.emit("requestfailed", {
    url: () => `${origin}/?tab=stablecoins&_rsc=route`,
    method: () => "GET",
    resourceType: () => "fetch",
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
  });
  assert.doesNotThrow(() => monitor.assertClean());

  page.emit("requestfailed", {
    url: () => `${origin}/_next/static/app.js`,
    method: () => "GET",
    resourceType: () => "script",
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
  });
  assert.throws(() => monitor.assertClean(), /same-origin request failed/);
});

test("browser failure monitor does not count redirects as successful assets", () => {
  const origin = "https://appmento-abc123-mentolabs.vercel.app";
  const page = new EventEmitter();
  const monitor = createBrowserFailureMonitor(page, origin);
  for (const path of [
    "/_next/static/app.js",
    "/_next/static/app.css",
    "/_next/static/font.woff2",
  ]) {
    page.emit("response", {
      url: () => new URL(path, origin).toString(),
      status: () => 302,
    });
  }
  assert.throws(() => monitor.assertClean(), /observed no successful scripts/);
});

test("browser smoke closes Chromium after an interaction-time failure", async () => {
  const values = controllerTuple("app");
  const page = new FakePage(values, {
    afterInteraction(currentPage) {
      currentPage.emit("pageerror", new Error("late hydration failure"));
    },
  });
  const fake = fakeChromium(page);
  await assert.rejects(
    runBrowserSmoke({ chromium: fake.chromium, values }),
    /late hydration failure/,
  );
  assert.equal(fake.state.closed, true);
});

test("browser smoke rejects a late cross-origin redirect after interaction", async () => {
  const values = controllerTuple("reserve");
  const page = new FakePage(values, {
    afterInteraction(currentPage) {
      currentPage.currentUrl = "https://example.com/?tab=stablecoins";
    },
  });
  const fake = fakeChromium(page);

  await assert.rejects(
    runBrowserSmoke({ chromium: fake.chromium, values }),
    /escaped the immutable preview origin after interaction/,
  );
  assert.equal(fake.state.closed, true);
});

test("generic target smoke rejects UI so the stronger deployment-identity path cannot be bypassed", async () => {
  const values = controllerTuple("app");
  const uiValues = {
    ...values,
    logicalTarget: "ui",
    deploymentUrl: "https://uimento-abc123-mentolabs.vercel.app/",
    verificationKey: `vercel-preview:v1:pr:520:target:ui:sha:${SHA}`,
    nextDeploymentId: "m-ui-0123456789abcdef012",
    expectedProjectId: "prj_ui",
    metadataLogicalTarget: "ui",
    metadataProjectId: "prj_ui",
    metadataUrl: "https://uimento-abc123-mentolabs.vercel.app/",
  };
  await assert.rejects(
    runBrowserSmoke({
      chromium: fakeChromium(new FakePage(uiValues)).chromium,
      values: uiValues,
    }),
    /UI must use its deployment-identity browser smoke/,
  );
});

test("trusted checkout resolves the pinned Playwright package", async () => {
  const chromium = await loadTrustedChromium(repoRoot);
  assert.equal(typeof chromium.launch, "function");
});
