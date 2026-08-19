import { PoolType, type Pool } from "@mento-protocol/mento-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  readPoolTradingLimitsStrict,
  type TradingLimitsPublicClient,
} from "./strict-trading-limits";

const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POOL = "0x1111111111111111111111111111111111111111";
const EXCHANGE_ID =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

function makePool(poolType: PoolType): Pool {
  return {
    factoryAddr: "0xffffffffffffffffffffffffffffffffffffffff",
    poolAddr: POOL,
    poolType,
    token0: TOKEN_A,
    token1: TOKEN_B,
    ...(poolType === PoolType.Virtual ? { exchangeId: EXCHANGE_ID } : {}),
  };
}

function makeClient(readContract: ReturnType<typeof vi.fn>) {
  return { readContract } as unknown as TradingLimitsPublicClient;
}

describe("readPoolTradingLimitsStrict", () => {
  it("tags a sparse FPMM L1 limit without shifting it into L0", async () => {
    const readContract = vi.fn(({ args }) => {
      const configured = args[0].toLowerCase() === TOKEN_A;
      return Promise.resolve([
        {
          limit0: 0n,
          limit1: configured ? 500n : 0n,
          decimals: 15,
        },
        {
          lastUpdated0: 0,
          lastUpdated1: Math.floor(Date.now() / 1000),
          netflow0: 0n,
          netflow1: 0n,
        },
      ]);
    });

    await expect(
      readPoolTradingLimitsStrict(
        makeClient(readContract),
        42220,
        makePool(PoolType.FPMM),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ asset: TOKEN_A, maxIn: 500n, tier: "L1" }),
    ]);
  });

  it("tags a sparse Virtual LG limit without shifting it into L0", async () => {
    const readContract = vi.fn(({ functionName }) => {
      if (functionName === "tradingLimitsConfig") {
        return Promise.resolve([300, 86_400, 0n, 0n, 900n, 0x04]);
      }
      return Promise.resolve([0, 0, 0n, 0n, 0n]);
    });

    const limits = await readPoolTradingLimitsStrict(
      makeClient(readContract),
      42220,
      makePool(PoolType.Virtual),
    );

    expect(limits).toEqual([
      expect.objectContaining({ asset: TOKEN_A, maxIn: 900n, tier: "LG" }),
      expect.objectContaining({ asset: TOKEN_B, maxIn: 900n, tier: "LG" }),
    ]);
  });

  it("propagates contract read failures", async () => {
    const readFailure = new Error("RPC unavailable");
    const readContract = vi.fn().mockRejectedValue(readFailure);

    await expect(
      readPoolTradingLimitsStrict(
        makeClient(readContract),
        42220,
        makePool(PoolType.FPMM),
      ),
    ).rejects.toBe(readFailure);
  });
});
