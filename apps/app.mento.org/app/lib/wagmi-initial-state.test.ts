import { describe, expect, it, vi } from "vitest";

const { cookieToInitialState, deserialize } = vi.hoisted(() => ({
  cookieToInitialState: vi.fn(),
  deserialize: vi.fn(),
}));

vi.mock("@repo/web3/wagmi-ssr", () => ({
  cookieToInitialState,
  deserialize,
  wagmiSsrConfig: { storage: { key: "wagmi" } },
}));

import { getWagmiInitialState } from "./wagmi-initial-state";

describe("getWagmiInitialState", () => {
  it("returns the parsed state for a valid cookie", () => {
    const state = { chainId: 42220 };
    deserialize.mockReturnValue({ state: {} });
    cookieToInitialState.mockReturnValue(state);

    expect(getWagmiInitialState('wagmi.store={"state":{}}')).toBe(state);
  });

  it("returns no state when the request has no cookie", () => {
    cookieToInitialState.mockReturnValue(undefined);

    expect(getWagmiInitialState(null)).toBeUndefined();
  });

  it("ignores malformed cookie state so SSR can continue", () => {
    deserialize.mockImplementation(() => {
      throw new SyntaxError("malformed cookie");
    });

    expect(getWagmiInitialState("wagmi.store=truncated")).toBeUndefined();
  });

  it("ignores structurally invalid cookie state during deserialization", () => {
    deserialize.mockImplementation(() => {
      throw new TypeError("object is not iterable");
    });

    expect(
      getWagmiInitialState('wagmi.store={"__type":"Map","value":{}}'),
    ).toBeUndefined();
  });

  it("does not hide parser failures after valid deserialization", () => {
    const error = new TypeError("unexpected parser failure");
    deserialize.mockReturnValue({ state: {} });
    cookieToInitialState.mockImplementation(() => {
      throw error;
    });

    expect(() => getWagmiInitialState('wagmi.store={"state":{}}')).toThrow(
      error,
    );
  });

  it("does not hide unexpected parser failures", () => {
    const error = new TypeError("unexpected parser failure");
    cookieToInitialState.mockImplementation(() => {
      throw error;
    });

    expect(() => getWagmiInitialState("other.store=valid")).toThrow(error);
  });
});
