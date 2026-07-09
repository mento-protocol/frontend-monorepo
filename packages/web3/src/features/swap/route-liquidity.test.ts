import { describe, expect, it, vi } from "vitest";
import {
  type Mento,
  type Route,
  encodeRoutePath,
} from "@mento-protocol/mento-sdk";
import { SWAP_INSUFFICIENT_LIQUIDITY_LABEL } from "@/features/swap/error-handlers";
import { validateRouteLiquidity } from "./route-liquidity";

const FACTORY = "0xffffffffffffffffffffffffffffffffffffffff";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const POOL_1 = "0x1111111111111111111111111111111111111111";
const POOL_2 = "0x2222222222222222222222222222222222222222";

interface PoolStub {
  poolAddr: string;
  factoryAddr: string;
  token0: string;
  token1: string;
}

interface HopStub {
  factory: string;
  from: string;
  to: string;
}

type Reserves = { reserve0: bigint; reserve1: bigint };

function makeRoute(pools: PoolStub[]): Route {
  return { path: pools } as unknown as Route;
}

function makeRouterRoutes(hops: HopStub[]): ReturnType<typeof encodeRoutePath> {
  return hops as unknown as ReturnType<typeof encodeRoutePath>;
}

function makeAmounts(
  values: bigint[],
): Parameters<typeof validateRouteLiquidity>[0]["amounts"] {
  return values as unknown as Parameters<
    typeof validateRouteLiquidity
  >[0]["amounts"];
}

function makeMento(reservesByPool: Record<string, Reserves>): {
  mento: Mento;
  getPoolDetails: ReturnType<typeof vi.fn>;
} {
  const getPoolDetails = vi.fn((poolAddr: string) => {
    const reserves = reservesByPool[poolAddr.toLowerCase()];
    return Promise.resolve(reserves);
  });
  const mento = { pools: { getPoolDetails } } as unknown as Mento;
  return { mento, getPoolDetails };
}

describe("validateRouteLiquidity", () => {
  it("resolves without querying pool details for an empty route", async () => {
    const { mento, getPoolDetails } = makeMento({});
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([]),
        amounts: makeAmounts([100n]),
        routerRoutes: makeRouterRoutes([]),
      }),
    ).resolves.toBeUndefined();
    expect(getPoolDetails).not.toHaveBeenCalled();
  });

  it("rejects when amounts length does not equal hops + 1", async () => {
    const { mento } = makeMento({});
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).rejects.toThrow("Unable to validate swap liquidity.");
  });

  it("resolves when the hop output is strictly below the reserve", async () => {
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 999n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects with the insufficient-liquidity label when output equals the reserve", async () => {
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 1000n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).rejects.toThrow(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
  });

  it("rejects with the insufficient-liquidity label when output exceeds the reserve", async () => {
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 1001n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).rejects.toThrow(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
  });

  it("selects reserve1 when the hop output token is token1", async () => {
    // hop.to === token1 → reserve1 is the constraint (reserve0 is irrelevant).
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 1n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 999n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).resolves.toBeUndefined();
  });

  it("selects reserve0 when the hop output token is token0 (reversed direction)", async () => {
    // hop.to === token0 → reserve0 is the constraint; low reserve0 forces rejection.
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 500n, reserve1: 100000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 600n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_B, to: TOKEN_A },
        ]),
      }),
    ).rejects.toThrow(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
  });

  it("matches pool and token addresses case-insensitively", async () => {
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1.toUpperCase().replace("0X", "0x"),
            factoryAddr: FACTORY.toUpperCase().replace("0X", "0x"),
            token0: TOKEN_A.toUpperCase().replace("0X", "0x"),
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 999n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects when no pool matches a hop", async () => {
    const { mento } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 999n]),
        // hop references TOKEN_C which no pool contains.
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_C },
        ]),
      }),
    ).rejects.toThrow("Unable to validate swap liquidity.");
  });

  it("rejects when pool details are missing for a matched pool", async () => {
    // getPoolDetails resolves undefined → the `!details` guard trips.
    const { mento } = makeMento({});
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        amounts: makeAmounts([100n, 999n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
        ]),
      }),
    ).rejects.toThrow("Unable to validate swap liquidity.");
  });

  it("validates a multi-hop route across two pools with the same token pair", async () => {
    // Both pools trade the A/B pair; the splice ensures each hop consumes a
    // distinct pool rather than re-matching the first.
    const { mento, getPoolDetails } = makeMento({
      [POOL_1.toLowerCase()]: { reserve0: 0n, reserve1: 1000n },
      [POOL_2.toLowerCase()]: { reserve0: 2000n, reserve1: 0n },
    });
    await expect(
      validateRouteLiquidity({
        mento,
        route: makeRoute([
          {
            poolAddr: POOL_1,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
          {
            poolAddr: POOL_2,
            factoryAddr: FACTORY,
            token0: TOKEN_A,
            token1: TOKEN_B,
          },
        ]),
        // hop 1: A→B uses POOL_1.reserve1 (1000); hop 2: B→A uses POOL_2.reserve0 (2000).
        amounts: makeAmounts([100n, 900n, 1900n]),
        routerRoutes: makeRouterRoutes([
          { factory: FACTORY, from: TOKEN_A, to: TOKEN_B },
          { factory: FACTORY, from: TOKEN_B, to: TOKEN_A },
        ]),
      }),
    ).resolves.toBeUndefined();
    expect(getPoolDetails).toHaveBeenCalledTimes(2);
  });
});
