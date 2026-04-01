import { describe, expect, it, vi } from "vitest";

vi.mock("./chains", () => ({
  ChainId: {
    Celo: 42220,
    CeloSepolia: 11142220,
    Monad: 143,
    MonadTestnet: 10143,
  },
}));

import {
  getMainnetFallbackChainId,
  getPreferredVisibleChain,
  getVisibleChains,
  isFeatureConfiguredOnChain,
  isFeatureSupported,
  isTestnetChain,
} from "./chain-policy";

const ChainId = {
  Celo: 42220,
  CeloSepolia: 11142220,
  Monad: 143,
  MonadTestnet: 10143,
} as const;

describe("chain-policy", () => {
  it("hides testnets when testnet mode is off", () => {
    expect(getVisibleChains({ testnetMode: false })).toEqual([
      ChainId.Celo,
      ChainId.Monad,
    ]);
  });

  it("shows testnets when testnet mode is on", () => {
    expect(getVisibleChains({ testnetMode: true })).toEqual([
      ChainId.Celo,
      ChainId.CeloSepolia,
      ChainId.Monad,
      ChainId.MonadTestnet,
    ]);
  });

  it("gates feature support by testnet mode", () => {
    expect(
      isFeatureSupported({
        chainId: ChainId.CeloSepolia,
        feature: "borrow",
        testnetMode: false,
      }),
    ).toBe(false);

    expect(
      isFeatureSupported({
        chainId: ChainId.CeloSepolia,
        feature: "borrow",
        testnetMode: true,
      }),
    ).toBe(true);

    expect(
      isFeatureSupported({
        chainId: ChainId.MonadTestnet,
        feature: "borrow",
        testnetMode: true,
      }),
    ).toBe(false);
  });

  it("keeps bridge mainnet-only even with testnet mode enabled", () => {
    expect(
      isFeatureConfiguredOnChain({
        chainId: ChainId.MonadTestnet,
        feature: "bridge",
      }),
    ).toBe(false);
  });

  it("maps testnets back to their mainnet fallback", () => {
    expect(getMainnetFallbackChainId(ChainId.CeloSepolia)).toBe(ChainId.Celo);
    expect(getMainnetFallbackChainId(ChainId.MonadTestnet)).toBe(ChainId.Monad);
    expect(getMainnetFallbackChainId(ChainId.Celo)).toBe(ChainId.Celo);
  });

  it("picks a visible mainnet fallback for wallet-derived routes", () => {
    expect(
      getPreferredVisibleChain({
        chainId: ChainId.CeloSepolia,
        feature: "swap",
        testnetMode: false,
      }),
    ).toBe(ChainId.Celo);
  });

  it("identifies testnet chains", () => {
    expect(isTestnetChain(ChainId.CeloSepolia)).toBe(true);
    expect(isTestnetChain(ChainId.MonadTestnet)).toBe(true);
    expect(isTestnetChain(ChainId.Celo)).toBe(false);
  });
});
