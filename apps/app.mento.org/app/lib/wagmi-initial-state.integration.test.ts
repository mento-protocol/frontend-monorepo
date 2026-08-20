import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/web3/wagmi-ssr", async () => {
  const { cookieToInitialState, deserialize } = await import("wagmi");

  return {
    cookieToInitialState,
    deserialize,
    wagmiSsrConfig: { storage: { key: "wagmi" } },
  };
});

import { getWagmiInitialState } from "./wagmi-initial-state";

describe("getWagmiInitialState with the Wagmi parser", () => {
  it("ignores a structurally invalid null cookie value", () => {
    expect(getWagmiInitialState("wagmi.store=null")).toBeUndefined();
  });

  it("ignores a structurally invalid null state", () => {
    expect(getWagmiInitialState('wagmi.store={"state":null}')).toBeUndefined();
  });

  it("ignores a structurally invalid Map value", () => {
    expect(
      getWagmiInitialState('wagmi.store={"__type":"Map","value":{}}'),
    ).toBeUndefined();
  });
});
