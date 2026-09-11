import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ENDPOINTS,
  DEFAULT_MAX_LAG_SECONDS,
  checkEndpoint,
  evaluateMeta,
  resolveEndpoints,
} from "./check-troves-subgraph.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TROVES_SUBGRAPH_TS = path.join(
  repoRoot,
  "packages/web3/src/features/borrow/troves-subgraph.ts",
);

const NOW = 1_788_365_611;

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: "",
    json: async () => payload,
  };
}

function healthyPayload({ timestamp = NOW, hasIndexingErrors = false } = {}) {
  return {
    data: {
      _meta: {
        block: { number: 76464853, timestamp: String(timestamp) },
        deployment: "QmWbKHCemHmg7o6yopyMC8Gx1sbGA9gAx8ZFcewg3sYAxd",
        hasIndexingErrors,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Drift guard. The checker duplicates the endpoint defaults because it is a
// plain .mjs script and cannot import the TypeScript module. If the two lists
// separate, the checker silently starts probing URLs the app no longer uses —
// which would be a worse failure than having no checker at all.
// ---------------------------------------------------------------------------

test("defaults stay in sync with troves-subgraph.ts", () => {
  const source = readFileSync(TROVES_SUBGRAPH_TS, "utf8");
  const defaultsBlock = source.slice(
    source.indexOf("const DEFAULT_TROVES_SUBGRAPH_URLS"),
    source.indexOf("const TROVES_SUBGRAPH_URL_OVERRIDES"),
  );
  assert.ok(defaultsBlock, "could not locate the defaults block");

  const urls = [...defaultsBlock.matchAll(/"(https:\/\/[^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    urls.sort(),
    DEFAULT_ENDPOINTS.map((endpoint) => endpoint.url).sort(),
  );
});

test("env var names match the ones troves-subgraph.ts reads", () => {
  const source = readFileSync(TROVES_SUBGRAPH_TS, "utf8");
  for (const { envVar } of DEFAULT_ENDPOINTS) {
    assert.ok(
      source.includes(`process.env.${envVar}`),
      `${envVar} is not read by troves-subgraph.ts`,
    );
  }
});

test("no default is pinned to /version/latest", () => {
  for (const endpoint of DEFAULT_ENDPOINTS) {
    assert.ok(
      !endpoint.url.includes("/version/latest"),
      `${endpoint.name} is pinned to /version/latest, the #865 failure`,
    );
    assert.match(endpoint.url, /\/v\d+\.\d+\.\d+$/);
  }
});

// ---------------------------------------------------------------------------
// resolveEndpoints
// ---------------------------------------------------------------------------

test("resolveEndpoints falls back to defaults with no env set", () => {
  const resolved = resolveEndpoints({});
  assert.deepEqual(
    resolved.map((endpoint) => endpoint.url),
    DEFAULT_ENDPOINTS.map((endpoint) => endpoint.url),
  );
  assert.ok(resolved.every((endpoint) => endpoint.overridden === false));
});

test("resolveEndpoints applies and trims an override", () => {
  const [celo] = resolveEndpoints({
    NEXT_PUBLIC_TROVES_SUBGRAPH_URL: "  https://example.com/celo  ",
  });
  assert.equal(celo.url, "https://example.com/celo");
  assert.equal(celo.overridden, true);
});

test("resolveEndpoints ignores a blank override", () => {
  const [celo] = resolveEndpoints({ NEXT_PUBLIC_TROVES_SUBGRAPH_URL: "   " });
  assert.equal(celo.url, DEFAULT_ENDPOINTS[0].url);
  assert.equal(celo.overridden, false);
});

// ---------------------------------------------------------------------------
// evaluateMeta
// ---------------------------------------------------------------------------

test("evaluateMeta passes a synced, error-free subgraph", () => {
  const verdict = evaluateMeta(
    { ok: true, status: 200, payload: healthyPayload() },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, true);
  assert.equal(verdict.block, 76464853);
  assert.equal(verdict.lagSeconds, 0);
});

// The #865 signature: HTTP 200, GraphQL error body.
test("evaluateMeta fails a missing deployment reported as a GraphQL error", () => {
  const verdict = evaluateMeta(
    {
      ok: true,
      status: 200,
      payload: {
        errors: [
          { message: "deployment `u1724470/s118680/latest` does not exist" },
        ],
      },
    },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, false);
  assert.match(verdict.reason, /does not exist/);
});

test("evaluateMeta fails a non-ok HTTP response", () => {
  const verdict = evaluateMeta(
    { ok: false, status: 502, statusText: "Bad Gateway", payload: undefined },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, false);
  assert.equal(verdict.reason, "HTTP 502 Bad Gateway");
});

test("evaluateMeta fails when the subgraph reports indexing errors", () => {
  const verdict = evaluateMeta(
    {
      ok: true,
      status: 200,
      payload: healthyPayload({ hasIndexingErrors: true }),
    },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, false);
  assert.match(verdict.reason, /hasIndexingErrors/);
});

test("evaluateMeta fails a stalled subgraph", () => {
  const verdict = evaluateMeta(
    {
      ok: true,
      status: 200,
      payload: healthyPayload({
        timestamp: NOW - DEFAULT_MAX_LAG_SECONDS - 60,
      }),
    },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, false);
  assert.match(verdict.reason, /stalled/);
});

test("evaluateMeta tolerates lag inside the limit", () => {
  const verdict = evaluateMeta(
    {
      ok: true,
      status: 200,
      payload: healthyPayload({
        timestamp: NOW - DEFAULT_MAX_LAG_SECONDS + 60,
      }),
    },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, true);
});

test("evaluateMeta fails an empty body", () => {
  const verdict = evaluateMeta(
    { ok: true, status: 200, payload: undefined },
    { nowSeconds: NOW },
  );
  assert.equal(verdict.healthy, false);
  assert.match(verdict.reason, /no _meta block/);
});

// ---------------------------------------------------------------------------
// checkEndpoint
// ---------------------------------------------------------------------------

test("checkEndpoint posts the meta query and reports health", async () => {
  const calls = [];
  const result = await checkEndpoint(
    { name: "celo", url: "https://example.com/celo" },
    {
      nowSeconds: NOW,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(healthyPayload());
      },
    },
  );

  assert.equal(result.healthy, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/celo");
  assert.equal(calls[0].init.method, "POST");
  assert.match(JSON.parse(calls[0].init.body).query, /_meta/);
});

test("checkEndpoint reports a transport failure instead of throwing", async () => {
  const result = await checkEndpoint(
    { name: "celo", url: "https://example.com/celo" },
    {
      nowSeconds: NOW,
      fetchImpl: async () => {
        throw new Error("ENOTFOUND");
      },
    },
  );
  assert.equal(result.healthy, false);
  assert.match(result.reason, /request failed: ENOTFOUND/);
});

test("checkEndpoint survives a non-JSON body", async () => {
  const result = await checkEndpoint(
    { name: "celo", url: "https://example.com/celo" },
    {
      nowSeconds: NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        statusText: "",
        json: async () => {
          throw new Error("not json");
        },
      }),
    },
  );
  assert.equal(result.healthy, false);
  assert.match(result.reason, /no _meta block/);
});
