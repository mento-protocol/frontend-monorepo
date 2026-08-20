import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/web3/wagmi-ssr", async () => {
  const { cookieToInitialState } = await import("wagmi");

  return {
    cookieToInitialState,
    wagmiSsrConfig: { storage: { key: "wagmi" } },
  };
});

import { getWagmiInitialState } from "./wagmi-initial-state";

describe("getWagmiInitialState with the Wagmi parser", () => {
  it("ignores a structurally invalid null cookie value", () => {
    expect(getWagmiInitialState("wagmi.store=null")).toBeUndefined();
  });
});
