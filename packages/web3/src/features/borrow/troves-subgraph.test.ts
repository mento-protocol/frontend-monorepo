import { afterEach, describe, expect, it, vi } from "vitest";
import { ChainId } from "@/config/chains";

// ---------------------------------------------------------------------------
// Trove-history subgraph endpoint resolution.
//
// The module reads its NEXT_PUBLIC_* overrides at import time (literal reads
// are required for Next's build-time inlining), so every override case has to
// reset the module registry and re-import rather than mutate a live binding.
// ---------------------------------------------------------------------------

const STUDIO_CELO =
  "https://api.studio.thegraph.com/query/1724470/mento-troves-celo/v0.0.1";
const STUDIO_SEPOLIA =
  "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.1";

// Every env var the module reads. Each case stubs ALL of them, defaulting to
// unset, so the ambient environment cannot leak in: CI really does define
// NEXT_PUBLIC_GRAPH_API_KEY (governance uses it), which silently turned the
// "no key configured" case into "key configured" and failed only in CI.
const MANAGED_ENV_VARS = [
  "NEXT_PUBLIC_TROVES_SUBGRAPH_URL",
  "NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA",
  "NEXT_PUBLIC_GRAPH_API_KEY",
] as const;

type ManagedEnvVar = (typeof MANAGED_ENV_VARS)[number];

async function loadModule(env: Partial<Record<ManagedEnvVar, string>> = {}) {
  vi.resetModules();
  for (const key of MANAGED_ENV_VARS) {
    // `undefined` deletes the variable rather than setting the string
    // "undefined", which is what makes the unset cases hermetic.
    vi.stubEnv(key, env[key]);
  }
  return import("./troves-subgraph");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getTrovesSubgraphUrl", () => {
  it("defaults to the deployed Studio endpoints", async () => {
    const { getTrovesSubgraphUrl } = await loadModule();
    expect(getTrovesSubgraphUrl(ChainId.Celo)).toBe(STUDIO_CELO);
    expect(getTrovesSubgraphUrl(ChainId.CeloSepolia)).toBe(STUDIO_SEPOLIA);
  });

  // Regression guard for #865. Studio resolves the trailing path segment as a
  // literal version label — `/version/latest` is not an alias and answers
  // HTTP 200 with `deployment ... does not exist`, which the panel renders as
  // a generic "could not load" error.
  it("never ships a `/version/latest` default", async () => {
    const { getTrovesSubgraphUrl } = await loadModule();
    for (const chainId of [ChainId.Celo, ChainId.CeloSepolia]) {
      expect(getTrovesSubgraphUrl(chainId)).not.toContain("/version/latest");
      expect(getTrovesSubgraphUrl(chainId)).toMatch(/\/v\d+\.\d+\.\d+$/);
    }
  });

  it("returns undefined for chains with no trove-history subgraph", async () => {
    const { getTrovesSubgraphUrl } = await loadModule();
    expect(getTrovesSubgraphUrl(ChainId.Monad)).toBeUndefined();
    expect(getTrovesSubgraphUrl(ChainId.Polygon)).toBeUndefined();
  });

  it("prefers a configured override", async () => {
    const { getTrovesSubgraphUrl } = await loadModule({
      NEXT_PUBLIC_TROVES_SUBGRAPH_URL:
        "https://gateway.thegraph.com/api/subgraphs/id/abc123",
      NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA:
        "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.2",
    });
    expect(getTrovesSubgraphUrl(ChainId.Celo)).toBe(
      "https://gateway.thegraph.com/api/subgraphs/id/abc123",
    );
    expect(getTrovesSubgraphUrl(ChainId.CeloSepolia)).toBe(
      "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.2",
    );
  });

  // A blank override must not collapse to `undefined`: callers read that as
  // "unsupported chain" and render "not indexed on this network yet", which
  // would hide a config mistake behind a plausible-looking message.
  it("falls back to the default when the override is blank or whitespace", async () => {
    const { getTrovesSubgraphUrl } = await loadModule({
      NEXT_PUBLIC_TROVES_SUBGRAPH_URL: "",
      NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA: "   ",
    });
    expect(getTrovesSubgraphUrl(ChainId.Celo)).toBe(STUDIO_CELO);
    expect(getTrovesSubgraphUrl(ChainId.CeloSepolia)).toBe(STUDIO_SEPOLIA);
  });

  it("trims a padded override", async () => {
    const { getTrovesSubgraphUrl } = await loadModule({
      NEXT_PUBLIC_TROVES_SUBGRAPH_URL: "  https://example.com/subgraph  ",
    });
    expect(getTrovesSubgraphUrl(ChainId.Celo)).toBe(
      "https://example.com/subgraph",
    );
  });
});

describe("getTrovesSubgraphHeaders", () => {
  it("sends no Authorization to Studio, even with a key configured", async () => {
    const { getTrovesSubgraphHeaders } = await loadModule({
      NEXT_PUBLIC_GRAPH_API_KEY: "secret-key",
    });
    expect(getTrovesSubgraphHeaders(STUDIO_CELO)).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("authenticates decentralized-network gateway queries", async () => {
    const { getTrovesSubgraphHeaders } = await loadModule({
      NEXT_PUBLIC_GRAPH_API_KEY: "secret-key",
    });
    expect(
      getTrovesSubgraphHeaders(
        "https://gateway.thegraph.com/api/subgraphs/id/abc123",
      ),
    ).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-key",
    });
  });

  it("omits Authorization for a gateway URL when no key is configured", async () => {
    const { getTrovesSubgraphHeaders } = await loadModule();
    expect(
      getTrovesSubgraphHeaders(
        "https://gateway.thegraph.com/api/subgraphs/id/abc123",
      ),
    ).toEqual({ "Content-Type": "application/json" });
  });

  it("does not leak the key to a lookalike host", async () => {
    const { getTrovesSubgraphHeaders } = await loadModule({
      NEXT_PUBLIC_GRAPH_API_KEY: "secret-key",
    });
    expect(
      getTrovesSubgraphHeaders("https://gateway.thegraph.com.evil.example/x"),
    ).toEqual({ "Content-Type": "application/json" });
  });

  it("does not throw on a malformed override URL", async () => {
    const { getTrovesSubgraphHeaders } = await loadModule({
      NEXT_PUBLIC_GRAPH_API_KEY: "secret-key",
    });
    expect(() => getTrovesSubgraphHeaders("not-a-url")).not.toThrow();
    expect(getTrovesSubgraphHeaders("not-a-url")).toEqual({
      "Content-Type": "application/json",
    });
  });
});
