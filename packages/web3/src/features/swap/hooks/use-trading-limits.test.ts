import {
  PoolType,
  type Mento,
  type Pool,
  type Route,
  type TradingLimit,
} from "@mento-protocol/mento-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tokenSymbolsByAddress = new Map<string, string>();

vi.mock("@/config/tokens", () => ({
  getTokenByAddress: vi.fn((address: string) => {
    const symbol = tokenSymbolsByAddress.get(address.toLowerCase());
    return symbol ? { symbol } : null;
  }),
}));

import { getRouteTradingLimits } from "./use-trading-limits";

const FACTORY = "0xffffffffffffffffffffffffffffffffffffffff";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const TOKEN_D = "0xdddddddddddddddddddddddddddddddddddddddd";
const POOL_1 = "0x1111111111111111111111111111111111111111";
const POOL_2 = "0x2222222222222222222222222222222222222222";
const POOL_3 = "0x3333333333333333333333333333333333333333";

function makePool(
  poolAddr: string,
  token0: string,
  token1: string,
  poolType: PoolType = PoolType.FPMM,
  exchangeId = poolAddr,
): Pool {
  return {
    factoryAddr: FACTORY,
    poolAddr,
    poolType,
    token0,
    token1,
    ...(poolType === PoolType.Virtual ? { exchangeId } : {}),
  };
}

function makeLimit(
  asset: string,
  value: bigint,
  decimals: number,
  until: number,
): TradingLimit {
  return {
    asset,
    decimals,
    maxIn: value,
    maxOut: value * 2n,
    until,
  };
}

function makeMento(limitsByPool: Record<string, TradingLimit[]>) {
  const getPoolTradingLimits = vi.fn((pool: Pool) =>
    Promise.resolve(limitsByPool[pool.poolAddr.toLowerCase()] ?? []),
  );
  return {
    getPoolTradingLimits,
    mento: { trading: { getPoolTradingLimits } } as unknown as Mento,
  };
}

beforeEach(() => {
  tokenSymbolsByAddress.clear();
  tokenSymbolsByAddress.set(TOKEN_A, "A");
  tokenSymbolsByAddress.set(TOKEN_B, "B");
  tokenSymbolsByAddress.set(TOKEN_C, "C");
  tokenSymbolsByAddress.set(TOKEN_D, "D");
});

describe("getRouteTradingLimits", () => {
  it("formats both directions for a direct FPMM route", async () => {
    const pool = makePool(POOL_1, TOKEN_A, TOKEN_B);
    const { mento } = makeMento({
      [POOL_1]: [
        makeLimit(TOKEN_A, 1_000n * 10n ** 15n, 15, 100),
        makeLimit(TOKEN_B, 2_000n * 10n ** 15n, 15, 100),
      ],
    });

    await expect(
      getRouteTradingLimits({
        chainId: 42220,
        mento,
        route: { path: [pool] } as Route,
        tokenInAddress: TOKEN_A,
        tokenOutAddress: TOKEN_B,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        direction: "in",
        hopIndex: 0,
        tokenSymbol: "A",
        L0: expect.objectContaining({ maxIn: "1000", maxOut: "2000" }),
      }),
      expect.objectContaining({
        direction: "out",
        hopIndex: 0,
        tokenSymbol: "B",
        L0: expect.objectContaining({ maxIn: "2000", maxOut: "4000" }),
      }),
    ]);
  });

  it("returns every configured limit across a mixed three-hop route", async () => {
    const pools = [
      makePool(POOL_1, TOKEN_A, TOKEN_B),
      makePool(POOL_2, TOKEN_B, TOKEN_C, PoolType.Virtual),
      makePool(POOL_3, TOKEN_C, TOKEN_D),
    ];
    const { mento, getPoolTradingLimits } = makeMento({
      [POOL_1]: [makeLimit(TOKEN_A, 100n * 10n ** 15n, 15, 100)],
      [POOL_2]: [makeLimit(TOKEN_B, 200n, 0, 100)],
      [POOL_3]: [makeLimit(TOKEN_D, 300n * 10n ** 15n, 15, 100)],
    });

    const limits = await getRouteTradingLimits({
      chainId: 42220,
      mento,
      route: { path: pools } as Route,
      tokenInAddress: TOKEN_A,
      tokenOutAddress: TOKEN_D,
    });

    expect(limits).toEqual([
      expect.objectContaining({
        direction: "in",
        hopIndex: 0,
        tokenSymbol: "A",
      }),
      expect.objectContaining({
        direction: "in",
        hopIndex: 1,
        tokenSymbol: "B",
        L0: expect.objectContaining({ maxIn: "200" }),
      }),
      expect.objectContaining({
        direction: "out",
        hopIndex: 2,
        tokenSymbol: "D",
      }),
    ]);
    expect(getPoolTradingLimits).toHaveBeenCalledTimes(3);
  });

  it("assigns hop indexes in reverse Router order", async () => {
    const pools = [
      makePool(POOL_1, TOKEN_A, TOKEN_B),
      makePool(POOL_2, TOKEN_B, TOKEN_C),
      makePool(POOL_3, TOKEN_C, TOKEN_D),
    ];
    const { mento } = makeMento({
      [POOL_3]: [makeLimit(TOKEN_D, 100n, 0, 100)],
      [POOL_2]: [makeLimit(TOKEN_C, 100n, 0, 100)],
      [POOL_1]: [makeLimit(TOKEN_A, 100n, 0, 100)],
    });

    const limits = await getRouteTradingLimits({
      chainId: 42220,
      mento,
      route: { path: pools } as Route,
      tokenInAddress: TOKEN_D,
      tokenOutAddress: TOKEN_A,
    });

    expect(
      limits.map(({ direction, hopIndex, tokenSymbol }) => ({
        direction,
        hopIndex,
        tokenSymbol,
      })),
    ).toEqual([
      { direction: "in", hopIndex: 0, tokenSymbol: "D" },
      { direction: "in", hopIndex: 1, tokenSymbol: "C" },
      { direction: "out", hopIndex: 2, tokenSymbol: "A" },
    ]);
  });

  it("reads a repeated pool only once", async () => {
    const pool = makePool(POOL_1, TOKEN_A, TOKEN_B);
    const { mento, getPoolTradingLimits } = makeMento({
      [POOL_1]: [makeLimit(TOKEN_A, 100n, 0, 100)],
    });

    await getRouteTradingLimits({
      chainId: 42220,
      mento,
      route: { path: [pool, pool, pool] } as Route,
      tokenInAddress: TOKEN_A,
      tokenOutAddress: TOKEN_B,
    });

    expect(getPoolTradingLimits).toHaveBeenCalledTimes(1);
  });

  it("reads virtual exchanges with a shared contract address separately", async () => {
    const firstPool = makePool(
      POOL_1,
      TOKEN_A,
      TOKEN_B,
      PoolType.Virtual,
      POOL_2,
    );
    const secondPool = makePool(
      POOL_1,
      TOKEN_B,
      TOKEN_C,
      PoolType.Virtual,
      POOL_3,
    );
    const getPoolTradingLimits = vi.fn((pool: Pool) =>
      Promise.resolve(
        pool.exchangeId === POOL_2
          ? [makeLimit(TOKEN_A, 100n, 0, 100)]
          : [makeLimit(TOKEN_C, 300n, 0, 100)],
      ),
    );
    const mento = {
      trading: { getPoolTradingLimits },
    } as unknown as Mento;

    const limits = await getRouteTradingLimits({
      chainId: 42220,
      mento,
      route: { path: [firstPool, secondPool] } as Route,
      tokenInAddress: TOKEN_A,
      tokenOutAddress: TOKEN_C,
    });

    expect(getPoolTradingLimits).toHaveBeenCalledTimes(2);
    expect(limits.map(({ tokenSymbol }) => tokenSymbol)).toEqual(["A", "C"]);
  });
});
