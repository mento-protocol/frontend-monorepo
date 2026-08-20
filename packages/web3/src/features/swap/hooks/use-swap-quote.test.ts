import type { RouterRoute } from "@mento-protocol/mento-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenDecimalsByAddress = new Map<string, number>();

vi.mock("@/config/tokens", () => ({
  getTokenByAddress: vi.fn((address: string) => {
    const decimals = tokenDecimalsByAddress.get(address.toLowerCase());
    return decimals == null ? null : { decimals };
  }),
  getTokenBySymbol: vi.fn(),
}));

import { formatRouteAmounts } from "./use-swap-quote";

const FACTORY = "0xffffffffffffffffffffffffffffffffffffffff";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const TOKEN_D = "0xdddddddddddddddddddddddddddddddddddddddd";

function route(from: string, to: string): RouterRoute {
  return {
    factory: FACTORY,
    from: from as `0x${string}`,
    to: to as `0x${string}`,
  };
}

describe("formatRouteAmounts", () => {
  beforeEach(() => {
    tokenDecimalsByAddress.clear();
  });

  it("formats every Router amount with its route token decimals", () => {
    tokenDecimalsByAddress.set(TOKEN_A, 6);
    tokenDecimalsByAddress.set(TOKEN_B, 18);
    tokenDecimalsByAddress.set(TOKEN_C, 6);
    tokenDecimalsByAddress.set(TOKEN_D, 18);

    expect(
      formatRouteAmounts(
        [1_000_000n, 2n * 10n ** 18n, 3_000_000n, 4n * 10n ** 18n],
        [
          route(TOKEN_A, TOKEN_B),
          route(TOKEN_B, TOKEN_C),
          route(TOKEN_C, TOKEN_D),
        ],
        42220,
      ),
    ).toEqual(["1", "2", "3", "4"]);
  });

  it("follows reverse Router order", () => {
    tokenDecimalsByAddress.set(TOKEN_A, 6);
    tokenDecimalsByAddress.set(TOKEN_B, 18);
    tokenDecimalsByAddress.set(TOKEN_C, 6);

    expect(
      formatRouteAmounts(
        [3_000_000n, 2n * 10n ** 18n, 1_000_000n],
        [route(TOKEN_C, TOKEN_B), route(TOKEN_B, TOKEN_A)],
        42220,
      ),
    ).toEqual(["3", "2", "1"]);
  });

  it("rejects an incomplete Router amount list", () => {
    expect(() =>
      formatRouteAmounts([1n], [route(TOKEN_A, TOKEN_B)], 42220),
    ).toThrow("Unable to map swap amounts to the route");
  });

  it("rejects a route token whose decimals are unavailable", () => {
    tokenDecimalsByAddress.set(TOKEN_A, 6);

    expect(() =>
      formatRouteAmounts(
        [1_000_000n, 2_000_000n],
        [route(TOKEN_A, TOKEN_B)],
        42220,
      ),
    ).toThrow("Unable to resolve token for swap route amount 1");
  });
});
