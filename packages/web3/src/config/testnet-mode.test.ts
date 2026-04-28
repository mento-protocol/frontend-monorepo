import { describe, expect, it, vi } from "vitest";

vi.mock("./chains", () => ({
  ChainId: {
    Celo: 42220,
    CeloSepolia: 11142220,
    Monad: 143,
    MonadTestnet: 10143,
  },
}));

import { readTestnetModeCookie } from "./testnet-mode";

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
