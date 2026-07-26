import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { setImmediate } from "node:timers";

import { chromium } from "@playwright/test";

import {
  drainProductionShadowRequestRoutes,
  fulfillProductionShadowRequest,
} from "./e2e/production-shadow/request-policy.mjs";
import defaultConfig from "./playwright.config.ts";
import productionShadowConfig from "./playwright.production-shadow.config.ts";

const BYPASS_HEADER = "x-vercel-protection-bypass";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function origin(server) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test("only the dedicated config collects production-shadow smoke specs", () => {
  for (const projectName of ["desktop", "mobile"]) {
    const project = defaultConfig.projects?.find(
      ({ name }) => name === projectName,
    );
    assert.ok(project, `${projectName} project must exist`);
    const ignored = Array.isArray(project.testIgnore)
      ? project.testIgnore
      : [project.testIgnore];
    assert.ok(
      ignored.some(
        (pattern) =>
          pattern instanceof RegExp &&
          pattern.test("production-shadow/smoke.spec.ts"),
      ),
      `${projectName} must not collect the production-shadow smoke`,
    );
  }

  assert.equal(
    productionShadowConfig.testDir,
    "./e2e/production-shadow",
    "the dedicated config must keep collecting the production-shadow smoke",
  );
  assert.deepEqual(
    productionShadowConfig.projects?.map(({ name }) => name),
    ["production-shadow"],
  );
});

test(
  "Chromium sends no protection header across a cross-origin redirect",
  { timeout: 30_000 },
  async () => {
    const received = { source: [], destination: [] };
    const destination = createServer((request, response) => {
      received.destination.push(request.headers[BYPASS_HEADER]);
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>destination</title><h1>safe</h1>");
    });
    await listen(destination);
    const destinationOrigin = origin(destination);

    const source = createServer((request, response) => {
      received.source.push(request.headers[BYPASS_HEADER]);
      response.writeHead(302, {
        location: `${destinationOrigin}/landing`,
      });
      response.end();
    });
    await listen(source);
    const sourceOrigin = origin(source);

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      assert.equal(browser.browserType().name(), "chromium");
      assert.match(browser.version(), /^\d+\./);

      const page = await browser.newPage();
      const requested = [];
      page.on("request", (request) => requested.push(request.url()));
      await page.route("**/*", async (route) => {
        await fulfillProductionShadowRequest({
          route,
        });
      });

      const response = await page.goto(`${sourceOrigin}/start`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200);
      assert.equal(page.url(), `${destinationOrigin}/landing`);
      assert.deepEqual(requested, [
        `${sourceOrigin}/start`,
        `${destinationOrigin}/landing`,
      ]);
      assert.deepEqual(received.source, [undefined]);
      assert.deepEqual(received.destination, [undefined]);
    } finally {
      await browser?.close();
      await Promise.all([close(source), close(destination)]);
    }
  },
);

test(
  "production-shadow teardown waits for an in-flight route fetch",
  { timeout: 30_000 },
  async () => {
    const requestStarted = deferred();
    const releaseResponse = deferred();
    const server = createServer(async (request, response) => {
      if (request.url === "/slow") {
        requestStarted.resolve();
        await releaseResponse.promise;
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("complete");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>source</title>");
    });
    await listen(server);
    const serverOrigin = origin(server);

    let browser;
    let requestOutcome;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.route("**/*", async (route) => {
        await fulfillProductionShadowRequest({ route });
      });
      await page.goto(serverOrigin, { waitUntil: "domcontentloaded" });

      requestOutcome = page
        .evaluate(async (url) => {
          const response = await fetch(url);
          return response.text();
        }, `${serverOrigin}/slow`)
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await requestStarted.promise;

      let teardownFinished = false;
      const teardown = drainProductionShadowRequestRoutes({ page }).then(() => {
        teardownFinished = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        teardownFinished,
        false,
        "teardown must wait while route.fetch is still active",
      );

      releaseResponse.resolve();
      await teardown;
      assert.deepEqual(await requestOutcome, { value: "complete" });
    } finally {
      releaseResponse.resolve();
      await requestOutcome;
      await browser?.close();
      await close(server);
    }
  },
);
