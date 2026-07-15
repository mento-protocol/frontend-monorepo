import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  createBrowserFailureMonitor,
  loadTrustedChromium,
  runBrowserSmoke,
  validateBrowserSmokeInput,
} from "./vercel-preview-browser-smoke.mjs";

const repoRoot = new URL("../../../", import.meta.url).pathname;

const SHA = "0123456789abcdef0123456789abcdef01234567";
const NEXT_DEPLOYMENT_ID = "m-ui-0123456789abcdef012";
const INPUT = {
  deploymentUrl: "https://ui-example-abc123.vercel.app",
  commitSha: SHA,
  idempotencyKey: `vercel-preview:v1:pr:519:target:ui:sha:${SHA}`,
  githubDeploymentId: "1234",
  vercelDeploymentId: "dpl_Abc123",
  nextDeploymentId: NEXT_DEPLOYMENT_ID,
};

class FakePage extends EventEmitter {
  constructor({ afterInteraction } = {}) {
    super();
    this.afterInteraction = afterInteraction;
    this.currentUrl = INPUT.deploymentUrl;
    this.checkboxChecked = false;
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
    this.currentUrl = new URL("/basic-components", url).toString();
    return { ok: () => true, status: () => 200 };
  }

  url() {
    return this.currentUrl;
  }

  locator(selector) {
    assert.equal(selector, "html");
    return {
      getAttribute: async (attribute) => {
        assert.equal(attribute, "data-dpl-id");
        return NEXT_DEPLOYMENT_ID;
      },
    };
  }

  getByPlaceholder(name, options) {
    assert.equal(name, "Search components...");
    assert.deepEqual(options, { exact: true });
    return {
      fill: async (value) => {
        this.calls.push(["fill", value]);
      },
    };
  }

  getByRole(role, options) {
    const key = `${role}:${options.name}`;
    if (role === "heading") {
      return {
        waitFor: async (waitOptions) => {
          this.calls.push(["heading", options.name, waitOptions]);
        },
      };
    }
    if (key === "link:Textarea") {
      return {
        click: async () => {
          this.calls.push(["click", "Textarea"]);
          this.currentUrl = new URL(
            "/form-components",
            INPUT.deploymentUrl,
          ).toString();
        },
      };
    }
    if (key === "checkbox:Checkbox option") {
      return {
        click: async () => {
          this.calls.push(["click", "Checkbox option"]);
          this.checkboxChecked = true;
        },
        isChecked: async () => this.checkboxChecked,
      };
    }
    throw new Error(`Unexpected role lookup: ${key}`);
  }

  async waitForURL(url, options) {
    assert.equal(
      typeof url,
      "string",
      "Playwright 1.61.1 waitForURL requires a supported string or RegExp matcher",
    );
    this.calls.push(["wait-for-url", url, options]);
    assert.equal(this.currentUrl, url);
  }

  async waitForTimeout(timeout) {
    this.calls.push(["settle", timeout]);
    this.afterInteraction?.(this);
  }
}

function fakeChromium(page) {
  const state = { launchOptions: null, closed: false };
  return {
    state,
    chromium: {
      async launch(options) {
        state.launchOptions = options;
        return {
          async newContext() {
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

test("browser smoke validates the immutable deployment identity tuple", () => {
  assert.deepEqual(validateBrowserSmokeInput(INPUT), {
    ...INPUT,
    deploymentUrl: `${INPUT.deploymentUrl}/`,
  });
  assert.throws(
    () => validateBrowserSmokeInput({ ...INPUT, commitSha: "main" }),
    /Commit SHA is missing or invalid/,
  );
  assert.throws(
    () =>
      validateBrowserSmokeInput({
        ...INPUT,
        idempotencyKey: `vercel-preview:v1:pr:519:target:ui:sha:${"f".repeat(40)}`,
      }),
    /does not match the exact commit SHA/,
  );
  assert.throws(
    () =>
      validateBrowserSmokeInput({
        ...INPUT,
        deploymentUrl: "https://ui-example.vercel.app.evil.test",
      }),
    /immutable HTTPS URL/,
  );
  assert.throws(
    () => validateBrowserSmokeInput({ ...INPUT, vercelDeploymentId: "123" }),
    /Vercel Deployment ID is missing or invalid/,
  );
});

test("trusted checkout resolves its own pinned Playwright package", async () => {
  const chromium = await loadTrustedChromium(repoRoot);
  assert.equal(typeof chromium.launch, "function");
});

test("browser smoke renders, navigates through search, and changes a control", async () => {
  const page = new FakePage();
  const fake = fakeChromium(page);
  const result = await runBrowserSmoke({
    chromium: fake.chromium,
    input: INPUT,
  });

  assert.deepEqual(fake.state.launchOptions, {
    channel: "chrome",
    headless: true,
  });
  assert.equal(fake.state.closed, true);
  assert.deepEqual(result.checkedRoutes, [
    "/basic-components",
    "/form-components",
  ]);
  assert.equal(result.interaction, "sidebar-search-and-checkbox");
  assert.ok(page.calls.some((call) => call[0] === "fill"));
  assert.ok(
    page.calls.some(
      (call) => call[0] === "click" && call[1] === "Checkbox option",
    ),
  );
});

test("browser smoke closes Chrome when a captured failure rejects the run", async () => {
  const page = new FakePage({
    afterInteraction(currentPage) {
      currentPage.emit("pageerror", new Error("hydration exploded"));
    },
  });
  const fake = fakeChromium(page);
  await assert.rejects(
    runBrowserSmoke({ chromium: fake.chromium, input: INPUT }),
    /page error: hydration exploded/,
  );
  assert.equal(fake.state.closed, true);
});

test("failure monitor records console, page, and same-origin network errors", () => {
  const page = new EventEmitter();
  const monitor = createBrowserFailureMonitor(
    page,
    "https://ui-example-abc123.vercel.app",
  );
  page.emit("console", {
    type: () => "error",
    text: () => "client console failure",
    location: () => ({ url: `${INPUT.deploymentUrl}/chunk.js` }),
  });
  page.emit("pageerror", new Error("uncaught render failure"));
  page.emit("requestfailed", {
    url: () => `${INPUT.deploymentUrl}/_next/static/chunk.js`,
    method: () => "GET",
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  });
  page.emit("response", {
    url: () => `${INPUT.deploymentUrl}/api/data`,
    status: () => 503,
  });

  assert.throws(
    () => monitor.assertClean(),
    (error) =>
      error.message.includes("console error: client console failure") &&
      error.message.includes("page error: uncaught render failure") &&
      error.message.includes("same-origin request failed: GET") &&
      error.message.includes("same-origin response failed: HTTP 503"),
  );
});

test("failure monitor ignores successful and cross-origin network activity", () => {
  const page = new EventEmitter();
  const monitor = createBrowserFailureMonitor(
    page,
    "https://ui-example-abc123.vercel.app",
  );
  page.emit("requestfailed", {
    url: () => "https://vercel.live/script.js",
    method: () => "GET",
    failure: () => ({ errorText: "blocked" }),
  });
  page.emit("response", {
    url: () => `${INPUT.deploymentUrl}/_next/static/chunk.js`,
    status: () => 200,
  });
  page.emit("console", {
    type: () => "warning",
    text: () => "not an error",
    location: () => ({}),
  });
  assert.doesNotThrow(() => monitor.assertClean());
});
