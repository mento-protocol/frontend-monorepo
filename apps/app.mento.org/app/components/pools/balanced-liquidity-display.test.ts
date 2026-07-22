import type { LiquidityQuoteResult, PoolDisplay } from "@repo/web3";
import { parseUnits } from "viem";
import { describe, expect, it } from "vitest";
import { getBalancedLiquidityDisplayState } from "./balanced-liquidity-display";

const pool = {
  token0: { decimals: 18 },
  token1: { decimals: 18 },
} as PoolDisplay;

describe("getBalancedLiquidityDisplayState", () => {
  it("uses the Router-clipped pair for both visible inputs and the summary", () => {
    const quote = {
      amountA: parseUnits("1938.824449465635730703", 18),
      amountB: parseUnits("1677.027867285683156092", 18),
    } as LiquidityQuoteResult;

    expect(
      getBalancedLiquidityDisplayState({
        quote,
        pool,
        rawToken0Amount: "2199.275594139894034278",
        rawToken1Amount: "1677.027867285683156092",
      }),
    ).toEqual({
      token0Amount: "1938.824449465635730703",
      token1Amount: "1677.027867285683156092",
      summaryToken0Amount: "1,938.824449465635730703",
      summaryToken1Amount: "1,677.027867285683156092",
    });
  });

  it("does not present an unquoted raw amount as the transaction summary", () => {
    expect(
      getBalancedLiquidityDisplayState({
        quote: null,
        pool,
        rawToken0Amount: "10",
        rawToken1Amount: "",
      }),
    ).toEqual({
      token0Amount: "10",
      token1Amount: "",
      summaryToken0Amount: "0",
      summaryToken1Amount: "0",
    });
  });
});
