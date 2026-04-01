import { describe, expect, it } from "vitest";

import {
  DEFAULT_STABILITY_CHAIN_ID,
  getStabilityChainName,
  getStabilityFallbackChainId,
  getStabilityRoute,
  getStabilitySwapRoute,
  isStabilityChainVisible,
  readTestnetModeCookie,
  resolveStabilityChainId,
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
});
