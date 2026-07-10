import { describe, expect, it, vi } from "vitest";

class ParsedAmount {
  constructor(private readonly value: number) {}

  gt(other: string | number) {
    return this.value > Number(other);
  }

  isZero() {
    return this.value === 0;
  }

  isNaN() {
    return Number.isNaN(this.value);
  }

  isFinite() {
    return Number.isFinite(this.value);
  }

  toFormat() {
    return this.value.toLocaleString("en-US");
  }
}

vi.mock("@repo/web3", () => ({
  parseAmountWithDefault: (
    value: string | number | null | undefined,
    defaultValue: string | number,
  ) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? new ParsedAmount(parsed)
      : new ParsedAmount(Number(defaultValue));
  },
}));

import {
  checkTradingLimitViolation,
  type SwapTradingLimits,
} from "./trading-limits";

const TOKEN_IN = "cUSD";
const TOKEN_OUT = "CELO";

function createLimits(tokenToCheck: string): SwapTradingLimits {
  return {
    tokenToCheck,
    L0: {
      maxIn: "1000",
      maxOut: "2000",
      total: "3000",
      until: 1_700_000_000,
    },
    L1: {
      maxIn: "4000",
      maxOut: "5000",
      total: "9000",
      until: 1_700_086_400,
    },
    LG: {
      maxIn: "10000",
      maxOut: "11000",
      total: "21000",
      until: 1_999_999_999,
    },
  };
}

function getExpectedDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

function parseAmountWithDefault(
  value: string | number | null | undefined,
  defaultValue: string | number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? new ParsedAmount(parsed)
    : new ParsedAmount(Number(defaultValue));
}

describe("checkTradingLimitViolation", () => {
  it("returns the L0 explicit-limit message for token in with locale-formatted reset time", () => {
    const limits = createLimits(TOKEN_IN);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("1000.01", 0),
        amountOut: parseAmountWithDefault("0", 0),
        limits,
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `The ${TOKEN_IN} amount exceeds the current trading limit of 1,000 ${TOKEN_IN} within 5min. It will be reset again to 3,000 ${TOKEN_IN} at ${getExpectedDate(limits.L0!.until!)}.`,
    );
  });

  it("returns the L1 explicit-limit message for token in", () => {
    const limits = createLimits(TOKEN_IN);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("4000.01", 0),
        amountOut: parseAmountWithDefault("0", 0),
        limits: {
          ...limits,
          LG: { ...limits.LG!, maxIn: "999999" },
          L0: { ...limits.L0!, maxIn: "999999" },
        },
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `The ${TOKEN_IN} amount exceeds the current trading limit of 4,000 ${TOKEN_IN} within 1d. It will be reset again to 9,000 ${TOKEN_IN} at ${getExpectedDate(limits.L1!.until!)}.`,
    );
  });

  it("returns the global explicit-limit message for token in", () => {
    const limits = createLimits(TOKEN_IN);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("10000.01", 0),
        amountOut: parseAmountWithDefault("0", 0),
        limits: {
          ...limits,
          L0: { ...limits.L0!, maxIn: "999999" },
          L1: { ...limits.L1!, maxIn: "999999" },
        },
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `The ${TOKEN_IN} amount exceeds the global trading limit of 10,000 ${TOKEN_IN}.`,
    );
  });

  it("returns the L0 implicit-limit message for token out with locale-formatted reset time", () => {
    const limits = createLimits(TOKEN_OUT);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("0", 0),
        amountOut: parseAmountWithDefault("2000.01", 0),
        limits,
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `Cannot buy more than 2,000 ${TOKEN_OUT} within 5min. The limit will reset to 3,000 ${TOKEN_OUT} at ${getExpectedDate(limits.L0!.until!)}.`,
    );
  });

  it("returns the L1 implicit-limit message for token out", () => {
    const limits = createLimits(TOKEN_OUT);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("0", 0),
        amountOut: parseAmountWithDefault("5000.01", 0),
        limits: {
          ...limits,
          LG: { ...limits.LG!, maxOut: "999999" },
          L0: { ...limits.L0!, maxOut: "999999" },
        },
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `Cannot buy more than 5,000 ${TOKEN_OUT} within 1d. The limit will reset to 9,000 ${TOKEN_OUT} at ${getExpectedDate(limits.L1!.until!)}.`,
    );
  });

  it("returns the global implicit-limit message for token out", () => {
    const limits = createLimits(TOKEN_OUT);

    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("0", 0),
        amountOut: parseAmountWithDefault("11000.01", 0),
        limits: {
          ...limits,
          L0: { ...limits.L0!, maxOut: "999999" },
          L1: { ...limits.L1!, maxOut: "999999" },
        },
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBe(
      `Cannot buy more than 11,000 ${TOKEN_OUT}. This exceeds the global trading limit.`,
    );
  });

  it("treats zero-valued tiers as not configured", () => {
    expect(
      checkTradingLimitViolation({
        amountIn: parseAmountWithDefault("10", 0),
        amountOut: parseAmountWithDefault("0", 0),
        limits: {
          tokenToCheck: TOKEN_IN,
          L0: { maxIn: "0", total: "0", until: 1_700_000_000 },
          L1: null,
          LG: null,
        },
        tokenInSymbol: TOKEN_IN,
        tokenOutSymbol: TOKEN_OUT,
      }),
    ).toBeNull();
  });
});
