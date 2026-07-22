import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { chromium } from "@playwright/test";

import { fulfillProductionShadowRequest } from "./e2e/production-shadow/request-policy.mjs";

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
