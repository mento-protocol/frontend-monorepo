import { describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/mento-sdk", () => {
  const TokenSymbol = {
    USDm: "USDm",
    USDC: "USDC",
    USD_: "USD₮",
    axlUSDC: "axlUSDC",
    AUSD: "AUSD",
    EURm: "EURm",
    axlEUROC: "axlEUROC",
  };

  return {
    TokenSymbol,
    TOKEN_ADDRESSES_BY_CHAIN: {
      42220: {
        [TokenSymbol.USDm]: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
        [TokenSymbol.USDC]: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        [TokenSymbol.USD_]: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
        [TokenSymbol.axlUSDC]: "0xEB466342C4d449BC9f53A865D5Cb90586f405215",
        [TokenSymbol.AUSD]: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
        [TokenSymbol.EURm]: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
        [TokenSymbol.axlEUROC]: "0x061cc5a2C863E0C1Cb404006D559dB18A34C762d",
      },
    },
  };
});

import {
  createPoolUsdPricingContext,
  getUsdTokenPrices,
} from "./usd-quote-metadata";

const chainId = 42220;
const USDM = "0x765DE816845861e75A25fCA122bb6898B8B1282a";
const EURM = "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73";
const AXL_EUROC = "0x061cc5a2C863E0C1Cb404006D559dB18A34C762d";

function createMockSdk(
  overrides?: Partial<{
    route: {
      path: Array<{
        poolAddr: string;
        token0: string;
        token1: string;
      }>;
    };
    details: {
      poolType: string;
      token0: string;
      token1: string;
      pricing: { oraclePrice: number } | null;
    };
  }>,
) {
  return {
    routes: {
      findRoute: vi.fn().mockResolvedValue(
        overrides?.route ?? {
          path: [{ poolAddr: "0xref", token0: EURM, token1: USDM }],
        },
      ),
    },
    pools: {
      getPoolDetails: vi.fn().mockResolvedValue(
        overrides?.details ?? {
          poolType: "FPMM",
          token0: EURM,
          token1: USDM,
          pricing: { oraclePrice: 1.08 },
        },
      ),
    },
  };
}

describe("getUsdTokenPrices", () => {
  it("keeps direct USD pool valuation unchanged", async () => {
    await expect(
      getUsdTokenPrices({
        token0Address: EURM,
        token1Address: USDM,
        oraclePrice: 1.08,
        chainId,
      }),
    ).resolves.toEqual({
      token0PriceUsd: 1.08,
      token1PriceUsd: 1,
    });
  });

  it("derives EUR pool pricing from the EURm/USDm reference pool", async () => {
    const sdk = createMockSdk({
      details: {
        poolType: "FPMM",
        token0: USDM,
        token1: EURM,
        pricing: { oraclePrice: 0.92 },
      },
    });
    const context = createPoolUsdPricingContext(sdk, chainId);

    const prices = await getUsdTokenPrices({
      token0Address: AXL_EUROC,
      token1Address: EURM,
      oraclePrice: 1,
      chainId,
      context,
    });

    expect(prices).toEqual({
      token0PriceUsd: 1 / 0.92,
      token1PriceUsd: 1 / 0.92,
    });
  });

  it("caches the EURm/USDm reference lookup within the shared context", async () => {
    const sdk = createMockSdk();
    const context = createPoolUsdPricingContext(sdk, chainId);

    await getUsdTokenPrices({
      token0Address: AXL_EUROC,
      token1Address: EURM,
      oraclePrice: 1,
      chainId,
      context,
    });
    await getUsdTokenPrices({
      token0Address: EURM,
      token1Address: AXL_EUROC,
      oraclePrice: 1,
      chainId,
      context,
    });

    expect(sdk.routes.findRoute).toHaveBeenCalledTimes(1);
    expect(sdk.pools.getPoolDetails).toHaveBeenCalledTimes(1);
  });

  it("returns null when the reference pool has no oracle pricing", async () => {
    const sdk = createMockSdk({
      details: {
        poolType: "FPMM",
        token0: EURM,
        token1: USDM,
        pricing: null,
      },
    });
    const context = createPoolUsdPricingContext(sdk, chainId);

    await expect(
      getUsdTokenPrices({
        token0Address: AXL_EUROC,
        token1Address: EURM,
        oraclePrice: 1,
        chainId,
        context,
      }),
    ).resolves.toBeNull();
  });
});
