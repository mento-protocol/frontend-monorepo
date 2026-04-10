import { describe, expect, it, vi } from "vitest";

// stability-route.ts imports @mento-protocol/mento-sdk (borrowRegistries) which
// has a broken ESM resolution in the test environment. Mock it before the module
// under test is loaded so the import resolves cleanly.
vi.mock("@mento-protocol/mento-sdk", () => ({
  borrowRegistries: {
    // Celo mainnet
    42220: { GBPm: "0x0000000000000000000000000000000000000001" },
    // Celo Sepolia
    11142220: { GBPm: "0x0000000000000000000000000000000000000002" },
  },
}));

// Also mock @repo/web3 so its re-exports of DEBT_TOKEN_CONFIGS etc. don't
// transitively pull in the SDK at collection time.
vi.mock("@repo/web3", () => ({
  DEBT_TOKEN_CONFIGS: {
    GBPm: {
      symbol: "GBPm",
      currencySymbol: "£",
      currencyCode: "GBP",
      locale: "en-GB",
      collateralSymbol: "USDm",
    },
  },
  getDebtTokenConfig: (symbol: string) => ({
    symbol,
    currencySymbol: symbol,
    currencyCode: symbol.replace(/m$/, ""),
    locale: "en-US",
    collateralSymbol: "USDm",
  }),
}));

import {
  DEFAULT_STABILITY_CHAIN_ID,
  getStabilityChainName,
  getStabilityFallbackChainId,
  getStabilityRoute,
  getStabilitySwapRoute,
  getSupportedDeployments,
  isStabilityChainVisible,
  readTestnetModeCookie,
  resolveStabilityChainId,
  resolveStabilityDebtToken,
  resolveStabilityDebtTokenAcrossDeployments,
} from "./stability-route";

describe("stability-route", () => {
  it("supports both configured stability chains", () => {
    expect(resolveStabilityChainId("celo")).toBe(42220);
    expect(resolveStabilityChainId("celo-sepolia")).toBe(11142220);
    expect(resolveStabilityChainId("monad")).toBeUndefined();
  });

  it("builds routes for the requested chain", () => {
    expect(getStabilityRoute("GBPm")).toBe("/earn/stability/celo/gbpm");
    expect(getStabilityRoute("GBPm", 11142220)).toBe(
      "/earn/stability/celo-sepolia/gbpm",
    );
    expect(getStabilitySwapRoute("GBPm", DEFAULT_STABILITY_CHAIN_ID)).toBe(
      "/swap/celo?from=USDm&to=GBPm",
    );
  });

  it("handles stability chain metadata and visibility", () => {
    expect(getStabilityChainName(42220)).toBe("Celo");
    expect(getStabilityChainName(11142220)).toBe("Celo Sepolia Testnet");
    expect(getStabilityFallbackChainId(11142220)).toBe(42220);
    expect(isStabilityChainVisible(11142220, false)).toBe(false);
    expect(isStabilityChainVisible(11142220, true)).toBe(true);
  });

  it("reads the testnet mode cookie", () => {
    expect(readTestnetModeCookie("mento_testnet_mode=1")).toBe(true);
    expect(readTestnetModeCookie("foo=bar")).toBe(false);
  });

  describe("getSupportedDeployments", () => {
    it("returns numeric chainIds, not strings", () => {
      const deployments = getSupportedDeployments();
      expect(deployments.length).toBeGreaterThan(0);
      for (const { chainId } of deployments) {
        expect(typeof chainId).toBe("number");
        // Strict numeric equality must hold — string "42220" !== number 42220
        expect(chainId === 42220 || chainId === 11142220).toBe(true);
      }
    });

    it("chainIds pass numeric includes() checks as used by earn-hub", () => {
      const deployments = getSupportedDeployments();
      const chainIds = deployments.map((d) => d.chainId);
      // This is the pattern used by visibleStabilityChains.includes(chainId)
      // downstream. Would silently fail if chainIds were strings.
      expect(chainIds.includes(42220)).toBe(true);
    });

    it("includes a token for each deployment", () => {
      const deployments = getSupportedDeployments();
      for (const { token } of deployments) {
        expect(typeof token.symbol).toBe("string");
        expect(token.symbol.length).toBeGreaterThan(0);
      }
    });
  });

  describe("resolveStabilityDebtToken", () => {
    it("resolves tokens only within the requested chain", () => {
      expect(resolveStabilityDebtToken("GBPm", 42220)?.symbol).toBe("GBPm");
      expect(resolveStabilityDebtToken("GBPm", 11142220)?.symbol).toBe("GBPm");
      expect(resolveStabilityDebtToken("USDm", 42220)).toBeUndefined();
    });

    it("keeps cross-deployment lookup explicit for legacy redirects", () => {
      expect(resolveStabilityDebtTokenAcrossDeployments("GBPm")?.symbol).toBe(
        "GBPm",
      );
      expect(
        resolveStabilityDebtTokenAcrossDeployments("USDm"),
      ).toBeUndefined();
    });
  });
});
