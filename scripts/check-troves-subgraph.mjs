#!/usr/bin/env node
/**
 * Liveness check for the trove-history subgraph endpoints behind the borrow
 * activity panel.
 *
 * Issue #865 sat broken in production for weeks because nothing ever asked the
 * endpoint whether it answered. The panel's only symptom was a generic red
 * "Could not load trove history" box, and the underlying failure — a Studio
 * version label that had been archived out from under a hardcoded URL — is
 * invisible to type checks, unit tests and builds alike.
 *
 * This asks each endpoint the one question that distinguishes all three
 * failure modes we actually care about:
 *
 *   - the URL resolves to no deployment at all (wrong/stale version label)
 *   - the deployment exists but is failing to index (`hasIndexingErrors`)
 *   - the deployment is healthy but has fallen behind the chain head
 *
 * Network-touching, so it is not wired into PR CI. Run it on a schedule or by
 * hand: `pnpm troves:subgraph:check`.
 */

import process from "node:process";

// Mirrors the defaults in
// packages/web3/src/features/borrow/troves-subgraph.ts. The accompanying test
// asserts the two lists stay in sync, so a URL bump there fails here loudly
// rather than drifting.
export const DEFAULT_ENDPOINTS = [
  {
    name: "celo",
    envVar: "NEXT_PUBLIC_TROVES_SUBGRAPH_URL",
    url: "https://api.studio.thegraph.com/query/1724470/mento-troves-celo/v0.0.1",
  },
  {
    name: "celo-sepolia",
    envVar: "NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA",
    url: "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.1",
  },
];

export const META_QUERY =
  "{ _meta { block { number timestamp } deployment hasIndexingErrors } }";

/** A subgraph more than this far behind wall-clock counts as stalled. */
export const DEFAULT_MAX_LAG_SECONDS = 900;

/**
 * Apply the env overrides the app itself would apply, so this checks the URLs
 * production actually queries rather than the compiled-in defaults.
 *
 * @param {Record<string, string | undefined>} env
 * @param {typeof DEFAULT_ENDPOINTS} [endpoints]
 */
export function resolveEndpoints(env, endpoints = DEFAULT_ENDPOINTS) {
  return endpoints.map((endpoint) => {
    const override = env[endpoint.envVar]?.trim();
    return {
      ...endpoint,
      url: override || endpoint.url,
      overridden: Boolean(override),
    };
  });
}

/**
 * Turn a raw `_meta` response into a pass/fail verdict. Pure — all the
 * classification logic lives here so it is testable without a network.
 *
 * @param {{ ok: boolean, status: number, statusText?: string, payload: unknown }} response
 * @param {{ nowSeconds: number, maxLagSeconds?: number }} options
 */
export function evaluateMeta(response, options) {
  const { nowSeconds, maxLagSeconds = DEFAULT_MAX_LAG_SECONDS } = options;

  if (!response.ok) {
    return {
      healthy: false,
      reason: `HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }`,
    };
  }

  const payload = /** @type {any} */ (response.payload);

  // Studio answers a bad version label with HTTP 200 + a GraphQL error, which
  // is exactly how #865 hid: every transport-level signal looked fine.
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return {
      healthy: false,
      reason: errors.map((error) => error?.message ?? String(error)).join("; "),
    };
  }

  const meta = payload?.data?._meta;
  if (!meta) {
    return { healthy: false, reason: "response contained no _meta block" };
  }

  if (meta.hasIndexingErrors) {
    return {
      healthy: false,
      reason: "subgraph reports hasIndexingErrors",
      block: meta.block?.number,
    };
  }

  const timestamp = Number(meta.block?.timestamp);
  if (!Number.isFinite(timestamp)) {
    return {
      healthy: false,
      reason: "_meta block carried no usable timestamp",
    };
  }

  const lagSeconds = nowSeconds - timestamp;
  if (lagSeconds > maxLagSeconds) {
    return {
      healthy: false,
      reason: `stalled — head block is ${Math.round(lagSeconds / 60)}m old (limit ${Math.round(maxLagSeconds / 60)}m)`,
      block: meta.block?.number,
      lagSeconds,
    };
  }

  return {
    healthy: true,
    block: meta.block?.number,
    deployment: meta.deployment,
    lagSeconds,
  };
}

/**
 * @param {{ name: string, url: string }} endpoint
 * @param {{ fetchImpl?: typeof fetch, nowSeconds?: number, maxLagSeconds?: number }} [options]
 */
export async function checkEndpoint(endpoint, options = {}) {
  const {
    fetchImpl = fetch,
    nowSeconds = Math.floor(Date.now() / 1000),
    maxLagSeconds = DEFAULT_MAX_LAG_SECONDS,
  } = options;

  let response;
  try {
    response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: META_QUERY }),
    });
  } catch (error) {
    return {
      ...endpoint,
      healthy: false,
      reason: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  return {
    ...endpoint,
    ...evaluateMeta(
      {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        payload,
      },
      { nowSeconds, maxLagSeconds },
    ),
  };
}

export async function main(env = process.env) {
  const endpoints = resolveEndpoints(env);
  const results = [];

  for (const endpoint of endpoints) {
    results.push(await checkEndpoint(endpoint));
  }

  for (const result of results) {
    const source = result.overridden ? `${result.envVar}` : "built-in default";
    if (result.healthy) {
      console.log(
        `✔ ${result.name} — block ${result.block}, ${result.lagSeconds}s behind (${source})`,
      );
      console.log(`  ${result.url}`);
    } else {
      console.error(`✘ ${result.name} — ${result.reason} (${source})`);
      console.error(`  ${result.url}`);
    }
  }

  const failed = results.filter((result) => !result.healthy);
  if (failed.length > 0) {
    console.error("");
    console.error(
      `${failed.length} of ${results.length} trove-history endpoints unhealthy.`,
    );
    console.error(
      "If a subgraph was redeployed in mento-protocol/bold, the Studio version",
    );
    console.error(
      "label changed and the previous version was archived. Update the URL in",
    );
    console.error(
      "packages/web3/src/features/borrow/troves-subgraph.ts, or set the",
    );
    console.error("override env var for the affected chain.");
    return 1;
  }

  console.log("");
  console.log(`All ${results.length} trove-history endpoints healthy.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
