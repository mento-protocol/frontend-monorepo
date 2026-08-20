import { describe, expect, it, vi } from "vitest";

vi.mock("./chains", () => ({
  ChainId: {
    Celo: 42220,
    CeloSepolia: 11142220,
    Monad: 143,
    MonadTestnet: 10143,
    Polygon: 137,
    PolygonAmoy: 80002,
    BaseSepolia: 84532,
  },
}));

import { readTestnetModeCookie, readTestnetModeStorage } from "./testnet-mode";

describe("testnet-mode cookie parsing", () => {
  it("reads enabled cookie values", () => {
    expect(readTestnetModeCookie("foo=bar; mento_testnet_mode=1")).toBe(true);
    expect(readTestnetModeCookie("mento_testnet_mode=true")).toBe(true);
  });

  it("reads disabled and missing cookie values", () => {
    expect(readTestnetModeCookie("mento_testnet_mode=0")).toBe(false);
    expect(readTestnetModeCookie("foo=bar")).toBe(false);
  });
});

describe("testnet-mode storage access", () => {
  it("falls back when localStorage is null", () => {
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: null },
    });

    try {
      expect(readTestnetModeStorage()).toBe(false);
      expect(readTestnetModeStorage(true)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("falls back when localStorage access throws", () => {
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() {
          throw new Error("localStorage is blocked");
        },
      },
    });

    try {
      expect(readTestnetModeStorage()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
