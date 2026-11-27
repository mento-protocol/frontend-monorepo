import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/web3", () => ({
  ChainId: {
    CeloSepolia: 11142220,
    Celo: 42220,
    MonadTestnet: 10143,
    Monad: 143,
    Polygon: 137,
    PolygonAmoy: 80002,
    BaseSepolia: 84532,
  },
}));

import {
  MATCHA_SWAP_URL,
  SQUID_SWAP_URL,
  swapAggregatorForChain,
} from "./external-links";

describe("swapAggregatorForChain", () => {
  it.each([42220, 11142220])("sends Celo chain %i to Squid", (chainId) => {
    expect(swapAggregatorForChain(chainId)).toEqual({
      name: "Squid",
      url: SQUID_SWAP_URL,
    });
  });

  it.each([137, 80002, 143, 10143])(
    "sends Polygon and Monad chain %i to Matcha",
    (chainId) => {
      expect(swapAggregatorForChain(chainId)).toEqual({
        name: "Matcha",
        url: MATCHA_SWAP_URL,
      });
    },
  );

  it("falls back to Squid for any other chain", () => {
    expect(swapAggregatorForChain(84532).name).toBe("Squid");
  });
});
