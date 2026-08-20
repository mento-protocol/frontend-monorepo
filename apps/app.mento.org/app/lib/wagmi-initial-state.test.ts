import { describe, expect, it, vi } from "vitest";

const { cookieToInitialState } = vi.hoisted(() => ({
  cookieToInitialState: vi.fn(),
}));

vi.mock("@repo/web3/wagmi-ssr", () => ({
  cookieToInitialState,
  wagmiSsrConfig: {},
}));

import { getWagmiInitialState } from "./wagmi-initial-state";

describe("getWagmiInitialState", () => {
  it("returns the parsed state for a valid cookie", () => {
    const state = { chainId: 42220 };
    cookieToInitialState.mockReturnValue(state);

    expect(getWagmiInitialState("wagmi.store=valid")).toBe(state);
  });

  it("returns no state when the request has no cookie", () => {
    cookieToInitialState.mockReturnValue(undefined);

    expect(getWagmiInitialState(null)).toBeUndefined();
  });

  it("ignores malformed cookie state so SSR can continue", () => {
    cookieToInitialState.mockImplementation(() => {
      throw new SyntaxError("malformed cookie");
    });

    expect(getWagmiInitialState("wagmi.store=truncated")).toBeUndefined();
  });

  it("does not hide unexpected parser failures", () => {
    const error = new TypeError("unexpected parser failure");
    cookieToInitialState.mockImplementation(() => {
      throw error;
    });

    expect(() => getWagmiInitialState("wagmi.store=valid")).toThrow(error);
  });
});
