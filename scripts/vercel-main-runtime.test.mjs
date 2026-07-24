import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertMainRuntimeSecurityHeaders,
  createMainRuntimeMonitor,
  formatMainRuntimeSummary,
  MAIN_RUNTIME_TARGETS,
  productionWalletFlagsAreAbsent,
  reserveSupplyStateMatches,
  runMainRuntimeSmoke,
  runMainRuntimeSmokeFromEnvironment,
  uiCheckboxStateMatches,
  validateMainRuntimeInput,
} from "./vercel-main-runtime.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function securityHeaders(sha = SHA) {
  return {
    "content-security-policy": "frame-ancestors 'none'",
    "content-security-policy-report-only": "default-src 'self'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-mento-deployment-sha": sha,
  };
}

function inputFor(target) {
  return {
    deploySha: SHA,
    logicalTarget: target,
    publicUrl: MAIN_RUNTIME_TARGETS[target].publicUrl,
  };
}

class FakeLocator {
  constructor(page, kind, name) {
    this.page = page;
    this.kind = kind;
    this.name = name;
  }

  getByRole(role, options) {
    assert.equal(this.kind, "banner");
    return new FakeLocator(this.page, role, options.name);
  }

  filter(options) {
    assert.deepEqual(options, { visible: true });
    return this;
  }

  async waitFor(options) {
    assert.deepEqual(options, { state: "visible" });
    this.page.calls.push(["wait", this.kind, this.name]);
    if (
      (this.name === "MetaMask" || this.name === "WalletConnect") &&
      !this.page.walletOpened
    ) {
      throw new Error(`${this.name} was not visible`);
    }
  }

  async click() {
    this.page.calls.push(["click", this.kind, this.name]);
    if (this.kind === "button" && this.name === "Connect") {
      this.page.walletOpened = true;
      return;
    }
    if (this.kind === "link" && this.name === "My Voting Power") {
      this.page.navigate("/voting-power");
      return;
    }
    if (this.kind === "tab" && this.name === "Supply") {
      this.page.supplySelected = true;
      this.page.navigate("/?tab=stablecoins");
      return;
    }
    if (this.kind === "link" && this.name === "Textarea") {
      this.page.navigate("/form-components");
      return;
    }
    if (this.kind === "checkbox" && this.name === "Checkbox option") {
      this.page.checkboxChecked = true;
      return;
    }
    throw new Error(`Unexpected click: ${this.kind}/${this.name}`);
  }

  async fill(value) {
    assert.equal(this.kind, "placeholder");
    assert.equal(this.name, "Search components...");
    assert.equal(value, "Textarea");
    this.page.searchValue = value;
    this.page.calls.push(["fill", value]);
  }

  async getAttribute(attribute) {
    assert.equal(attribute, "aria-selected");
    if (this.name === "Overview") {
      return this.page.supplySelected ? "false" : "true";
    }
    if (this.name === "Supply") {
      return this.page.supplySelected ? "true" : "false";
    }
    throw new Error(`Unexpected attribute locator: ${this.name}`);
  }

  async textContent() {
    return this.name;
  }

  async count() {
    assert.equal(this.name, "E2E Test Wallet");
    return this.page.mockWalletVisible ? 1 : 0;
  }

  async isChecked() {
    assert.equal(this.name, "Checkbox option");
    return this.page.checkboxChecked;
  }
}

class FakePage extends EventEmitter {
  constructor(
    target,
    {
      afterInteraction,
      headers = securityHeaders(),
      mockWalletVisible = false,
      omitResource,
      walletFlagsAbsent = true,
      wrongLanding,
    } = {},
  ) {
    super();
    this.target = target;
    this.config = MAIN_RUNTIME_TARGETS[target];
    this.afterInteraction = afterInteraction;
    this.responseHeaders = headers;
    this.mockWalletVisible = mockWalletVisible;
    this.omitResource = omitResource;
    this.walletFlagsAbsent = walletFlagsAbsent;
    this.wrongLanding = wrongLanding;
    this.currentUrl = this.config.publicUrl;
    this.frame = { url: () => this.currentUrl };
    this.calls = [];
    this.walletOpened = false;
    this.supplySelected = false;
    this.checkboxChecked = false;
  }

  setDefaultTimeout(timeout) {
    this.calls.push(["timeout", timeout]);
  }

  setDefaultNavigationTimeout(timeout) {
    this.calls.push(["navigation-timeout", timeout]);
  }

  mainFrame() {
    return this.frame;
  }

  response(path, resourceType, status = 200) {
    const url = new URL(path, this.config.publicUrl).toString();
    const request = {
      failure: () => null,
      method: () => "GET",
      resourceType: () => resourceType,
      url: () => url,
    };
    return {
      headers: () => this.responseHeaders,
      ok: () => status >= 200 && status < 400,
      request: () => request,
      status: () => status,
      url: () => url,
    };
  }

  navigate(path) {
    this.currentUrl = new URL(path, this.config.publicUrl).toString();
    this.emit("framenavigated", this.frame);
    this.emit("response", this.response(`${path}?_rsc=fixture`, "fetch"));
  }

  async goto(url, options) {
    assert.equal(url, this.config.publicUrl);
    assert.deepEqual(options, { waitUntil: "domcontentloaded" });
    const landingPath = this.wrongLanding ?? this.config.landingPath;
    this.currentUrl = new URL(landingPath, url).toString();
    this.emit("framenavigated", this.frame);
    const documentResponse = this.response(landingPath, "document");
    if (this.omitResource !== "document") {
      this.emit("response", documentResponse);
    }
    const resources = {
      font: "/_next/static/font.woff2",
      script: "/_next/static/app.js",
      stylesheet: "/_next/static/app.css",
    };
    for (const [type, path] of Object.entries(resources)) {
      if (this.omitResource === type) continue;
      this.emit("response", this.response(path, type));
    }
    return documentResponse;
  }

  url() {
    return this.currentUrl;
  }

  async waitForLoadState(state) {
    assert.equal(state, "load");
    this.calls.push(["load"]);
  }

  async waitForTimeout(timeout) {
    assert.equal(timeout, 500);
    this.afterInteraction?.(this);
    this.calls.push(["settle"]);
  }

  getByRole(role, options) {
    if (role === "banner") return new FakeLocator(this, "banner", "");
    return new FakeLocator(this, role, options.name);
  }

  getByText(name) {
    return new FakeLocator(this, "text", name);
  }

  getByPlaceholder(name) {
    return new FakeLocator(this, "placeholder", name);
  }

  async waitForURL(expected) {
    const expectedUrl =
      typeof expected === "string" ? expected : expected.toString();
    assert.equal(this.currentUrl, expectedUrl);
    this.calls.push(["wait-url", expectedUrl]);
  }

  async waitForFunction(predicate, argument) {
    assert.equal(await this.evaluate(predicate, argument), true);
    this.calls.push(["wait-function"]);
  }

  async evaluate(predicate, argument) {
    if (predicate === productionWalletFlagsAreAbsent) {
      return this.walletFlagsAbsent;
    }
    if (predicate === reserveSupplyStateMatches) {
      return predicate({
        ...argument,
        currentHref: this.currentUrl,
        selectedTabLabel: this.supplySelected ? "Supply" : "Overview",
      });
    }
    if (predicate === uiCheckboxStateMatches) {
      return this.checkboxChecked;
    }
    throw new Error("Unexpected page evaluator");
  }
}

function fakeChromium(page) {
  const state = {
    closed: false,
    contextOptions: null,
    launchOptions: null,
  };
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

test("hard-binds each logical target to its literal public URL and SHA", () => {
  for (const target of Object.keys(MAIN_RUNTIME_TARGETS)) {
    assert.deepEqual(validateMainRuntimeInput(inputFor(target)), {
      deploySha: SHA,
      logicalTarget: target,
      publicUrl: MAIN_RUNTIME_TARGETS[target].publicUrl,
    });
  }

  for (const invalid of [
    { ...inputFor("app"), logicalTarget: "unknown" },
    { ...inputFor("app"), publicUrl: "https://example.com/" },
    { ...inputFor("app"), publicUrl: "https://app.mento.org/path" },
    { ...inputFor("app"), publicUrl: "http://app.mento.org/" },
    { ...inputFor("app"), deploySha: "main" },
    { ...inputFor("app"), deploySha: SHA.toUpperCase() },
  ]) {
    assert.throws(
      () => validateMainRuntimeInput(invalid),
      /target|public URL mismatch|immutable lowercase/,
    );
  }
});

test("requires the exact deployment SHA and complete security-header contract", () => {
  assert.equal(assertMainRuntimeSecurityHeaders(securityHeaders(), SHA), true);

  for (const name of Object.keys(securityHeaders())) {
    const headers = securityHeaders();
    headers[name] = name === "x-mento-deployment-sha" ? "f".repeat(40) : "";
    assert.throws(
      () => assertMainRuntimeSecurityHeaders(headers, SHA),
      new RegExp(name),
      name,
    );
  }
  assert.throws(() => assertMainRuntimeSecurityHeaders(null, SHA), /malformed/);
});

test("runs the literal interaction contract for all four public targets", async () => {
  for (const target of Object.keys(MAIN_RUNTIME_TARGETS)) {
    const page = new FakePage(target);
    const fake = fakeChromium(page);
    const result = await runMainRuntimeSmoke({
      chromium: fake.chromium,
      values: inputFor(target),
    });

    assert.equal(result.logical_target, target);
    assert.equal(result.interaction, MAIN_RUNTIME_TARGETS[target].interaction);
    assert.equal(result.deploy_sha, SHA);
    assert.equal(result.successful_documents, 1);
    assert.equal(result.successful_scripts, 1);
    assert.equal(result.successful_stylesheets, 1);
    assert.equal(result.successful_fonts, 1);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(fake.state.launchOptions, { headless: true });
    assert.deepEqual(fake.state.contextOptions, { colorScheme: "dark" });
    assert.equal(fake.state.closed, true);
  }
});

test("App proves real production wallets without enabling preview flags", async () => {
  const page = new FakePage("app");
  await runMainRuntimeSmoke({
    chromium: fakeChromium(page).chromium,
    values: inputFor("app"),
  });
  assert.equal(page.walletOpened, true);
  assert.equal(
    page.calls.filter((entry) => {
      const [operation, , name] = entry;
      return (
        operation === "wait" &&
        (name === "MetaMask" || name === "WalletConnect")
      );
    }).length,
    2,
  );

  for (const options of [
    { walletFlagsAbsent: false },
    { mockWalletVisible: true },
  ]) {
    const failingPage = new FakePage("app", options);
    const fake = fakeChromium(failingPage);
    await assert.rejects(
      runMainRuntimeSmoke({
        chromium: fake.chromium,
        values: inputFor("app"),
      }),
      /preview or mock-wallet browser flags|preview-only E2E Test Wallet/,
    );
    assert.equal(fake.state.closed, true);
  }
});

test("production wallet flag predicate rejects each E2E activation key", () => {
  const values = new Map();
  const storage = { getItem: (name) => values.get(name) ?? null };
  assert.equal(productionWalletFlagsAreAbsent({ storage }), true);
  for (const name of [
    "mento_e2e_wallet",
    "mento_e2e_eager_connect",
    "mento_use_fork",
  ]) {
    values.set(name, "true");
    assert.equal(productionWalletFlagsAreAbsent({ storage }), false);
    values.clear();
  }
});

test("Reserve state predicate binds origin, route, query, and selected tab", () => {
  const expectedOrigin = "https://reserve.mento.org";
  const valid = {
    currentHref: `${expectedOrigin}/?tab=stablecoins`,
    expectedOrigin,
    selectedTabLabel: "Supply",
  };
  assert.equal(reserveSupplyStateMatches(valid), true);
  for (const invalid of [
    { currentHref: "https://example.com/?tab=stablecoins" },
    { currentHref: `${expectedOrigin}/path?tab=stablecoins` },
    { currentHref: `${expectedOrigin}/?tab=stablecoins&extra=true` },
    { currentHref: `${expectedOrigin}/?tab=collateral` },
    { selectedTabLabel: "Overview" },
    { selectedTabLabel: null },
  ]) {
    assert.equal(reserveSupplyStateMatches({ ...valid, ...invalid }), false);
  }
});

test("UI checkbox predicate requires semantic and component checked state", () => {
  const attributes = new Map([
    ["aria-checked", "true"],
    ["data-state", "checked"],
  ]);
  const checkbox = { getAttribute: (name) => attributes.get(name) ?? null };
  assert.equal(uiCheckboxStateMatches({ checkbox }), true);
  attributes.set("aria-checked", "false");
  assert.equal(uiCheckboxStateMatches({ checkbox }), false);
  attributes.set("aria-checked", "true");
  attributes.set("data-state", "unchecked");
  assert.equal(uiCheckboxStateMatches({ checkbox }), false);
  assert.equal(uiCheckboxStateMatches({ checkbox: null }), false);
});

function barePage(origin) {
  const page = new EventEmitter();
  const frame = { url: () => `${origin}/` };
  page.mainFrame = () => frame;
  return { frame, page };
}

function emitResponse(page, origin, resourceType, status = 200) {
  page.emit("response", {
    request: () => ({ resourceType: () => resourceType }),
    status: () => status,
    url: () => `${origin}/asset-${resourceType}`,
  });
}

function primeRequiredResources(page, origin) {
  for (const resourceType of ["document", "font", "script", "stylesheet"]) {
    emitResponse(page, origin, resourceType);
  }
}

test("monitor fails on page, console, origin, request, and response errors", () => {
  const origin = "https://app.mento.org";
  const { frame, page } = barePage(origin);
  const monitor = createMainRuntimeMonitor(page, origin);
  primeRequiredResources(page, origin);
  page.emit("pageerror", new Error("render exploded"));
  page.emit("console", {
    location: () => ({ url: `${origin}/_next/static/app.js` }),
    text: () => "hydration failed",
    type: () => "error",
  });
  frame.url = () => "https://example.com/";
  page.emit("framenavigated", frame);
  page.emit("requestfailed", {
    failure: () => ({ errorText: "net::ERR_FAILED" }),
    method: () => "GET",
    resourceType: () => "script",
    url: () => `${origin}/_next/static/fail.js`,
  });
  emitResponse(page, origin, "stylesheet", 503);

  assert.throws(
    () => monitor.assertClean(),
    (error) =>
      error.message.includes("render exploded") &&
      error.message.includes("hydration failed") &&
      error.message.includes("left expected origin") &&
      error.message.includes("script request failed") &&
      error.message.includes("stylesheet response failed"),
  );
});

test("monitor ignores only unrelated traffic and superseded same-origin RSC aborts", () => {
  const origin = "https://reserve.mento.org";
  const { page } = barePage(origin);
  const monitor = createMainRuntimeMonitor(page, origin);
  primeRequiredResources(page, origin);
  page.emit("requestfailed", {
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
    method: () => "GET",
    resourceType: () => "fetch",
    url: () => `${origin}/?tab=stablecoins&_rsc=route`,
  });
  page.emit("requestfailed", {
    failure: () => ({ errorText: "net::ERR_FAILED" }),
    method: () => "GET",
    resourceType: () => "image",
    url: () => `${origin}/optional.png`,
  });
  page.emit("requestfailed", {
    failure: () => ({ errorText: "net::ERR_FAILED" }),
    method: () => "GET",
    resourceType: () => "script",
    url: () => "https://third-party.example/script.js",
  });
  assert.doesNotThrow(() => monitor.assertClean());

  page.emit("requestfailed", {
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
    method: () => "GET",
    resourceType: () => "script",
    url: () => `${origin}/_next/static/app.js`,
  });
  assert.throws(() => monitor.assertClean(), /script request failed/);
});

test("monitor requires successful same-origin documents, scripts, styles, and fonts", async () => {
  for (const resourceType of ["document", "font", "script", "stylesheet"]) {
    const page = new FakePage("app", { omitResource: resourceType });
    const fake = fakeChromium(page);
    await assert.rejects(
      runMainRuntimeSmoke({
        chromium: fake.chromium,
        values: inputFor("app"),
      }),
      new RegExp(`no successful same-origin ${resourceType}`),
    );
    assert.equal(fake.state.closed, true);
  }
});

test("rejects wrong landing, final location, SHA header, and browser policy", async () => {
  const cases = [
    {
      page: new FakePage("ui", { wrongLanding: "/form-components" }),
      target: "ui",
      pattern: /public landing URL mismatch/,
    },
    {
      page: new FakePage("governance", {
        afterInteraction(currentPage) {
          currentPage.navigate("/");
        },
      }),
      target: "governance",
      pattern: /public interaction URL mismatch/,
    },
    {
      page: new FakePage("reserve", {
        headers: securityHeaders("f".repeat(40)),
      }),
      target: "reserve",
      pattern: /x-mento-deployment-sha mismatch/,
    },
  ];
  for (const scenario of cases) {
    const fake = fakeChromium(scenario.page);
    await assert.rejects(
      runMainRuntimeSmoke({
        chromium: fake.chromium,
        values: inputFor(scenario.target),
      }),
      scenario.pattern,
    );
    assert.equal(fake.state.closed, true);
  }

  await assert.rejects(
    runMainRuntimeSmoke({
      chromium: fakeChromium(new FakePage("app")).chromium,
      values: inputFor("app"),
      browserChannel: "unknown",
    }),
    /browser channel/,
  );
  await assert.rejects(
    runMainRuntimeSmoke({
      chromium: fakeChromium(new FakePage("app")).chromium,
      values: inputFor("app"),
      timeoutMs: 0,
    }),
    /bounded policy/,
  );
});

test("uses system Chrome only when explicitly selected", async () => {
  const page = new FakePage("app");
  const fake = fakeChromium(page);
  await runMainRuntimeSmoke({
    browserChannel: "chrome",
    chromium: fake.chromium,
    values: inputFor("app"),
  });
  assert.deepEqual(fake.state.launchOptions, {
    channel: "chrome",
    headless: true,
  });
});

test("environment entrypoint writes canonical outputs and summary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "main-runtime-"));
  const output = join(directory, "output");
  const summary = join(directory, "summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  try {
    const page = new FakePage("governance");
    const result = await runMainRuntimeSmokeFromEnvironment({
      chromium: fakeChromium(page).chromium,
      environment: {
        DEPLOY_SHA: SHA,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        LOGICAL_TARGET: "governance",
        PUBLIC_URL: MAIN_RUNTIME_TARGETS.governance.publicUrl,
      },
    });
    const outputText = readFileSync(output, "utf8");
    for (const [name, value] of Object.entries(result)) {
      assert.match(outputText, new RegExp(`^${name}=${value}$`, "m"));
    }
    assert.equal(
      readFileSync(summary, "utf8"),
      formatMainRuntimeSummary(result),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
