import { describe, expect, it } from "vitest";
import BigNumber from "bignumber.js";
import {
  calcExchangeRate,
  formatBalance,
  formatWithMaxDecimals,
  getMaxSellAmount,
  getMinBuyAmount,
  invertExchangeRate,
  isValidTokenPair,
} from "./utils";

describe("getMinBuyAmount", () => {
  it("reduces amount by slippage percentage", () => {
    // 1000 wei with 1% slippage → 990
    const result = getMinBuyAmount("1000", "1");
    expect(result.toFixed(0)).toBe("990");
  });

  it("handles 0.5% slippage correctly", () => {
    const result = getMinBuyAmount("1000", "0.5");
    expect(result.toFixed(0)).toBe("995");
  });

  it("handles 10% slippage correctly", () => {
    const result = getMinBuyAmount("1000", "10");
    expect(result.toFixed(0)).toBe("900");
  });

  it("returns BigNumber instance", () => {
    const result = getMinBuyAmount("1000", "1");
    expect(result).toBeInstanceOf(BigNumber);
  });

  it("floors decimal results", () => {
    // 999 * 0.99 = 989.01 → floors to 989
    const result = getMinBuyAmount("999", "1");
    expect(result.toFixed(0)).toBe("989");
  });
});

describe("getMaxSellAmount", () => {
  it("increases amount by slippage percentage", () => {
    // 1000 wei with 1% slippage → 1010
    const result = getMaxSellAmount("1000", "1");
    expect(result.toFixed(0)).toBe("1010");
  });

  it("handles 0.5% slippage correctly", () => {
    const result = getMaxSellAmount("1000", "0.5");
    expect(result.toFixed(0)).toBe("1005");
  });

  it("handles 10% slippage correctly", () => {
    const result = getMaxSellAmount("1000", "10");
    expect(result.toFixed(0)).toBe("1100");
  });

  it("returns BigNumber instance", () => {
    const result = getMaxSellAmount("1000", "1");
    expect(result).toBeInstanceOf(BigNumber);
  });

  it("rounds decimal results to integer (BigNumber ROUND_HALF_UP)", () => {
    // 999 * 1.01 = 1008.99 → rounds to 1009
    const result = getMaxSellAmount("999", "1");
    expect(result.toFixed(0)).toBe("1009");
  });
});

describe("calcExchangeRate", () => {
  const decimals18 = 18;
  const decimals6 = 6;

  it("computes a 1:1 exchange rate", () => {
    const oneToken = "1000000000000000000"; // 1e18
    const result = calcExchangeRate(oneToken, decimals18, oneToken, decimals18);
    expect(result).toBe("1.0000");
  });

  it("computes rate when 1 token buys 2 tokens", () => {
    const oneToken = "1000000000000000000"; // 1e18
    const twoTokens = "2000000000000000000"; // 2e18
    const result = calcExchangeRate(oneToken, decimals18, twoTokens, decimals18);
    expect(result).toBe("0.5000");
  });

  it("returns 0 for zero denominator", () => {
    const oneToken = "1000000000000000000";
    const result = calcExchangeRate(oneToken, decimals18, "0", decimals18);
    expect(result).toBe("0");
  });

  it("handles different decimal places (18 vs 6)", () => {
    const oneToken18 = "1000000000000000000"; // 1e18
    const oneToken6 = "1000000"; // 1e6
    const result = calcExchangeRate(oneToken18, decimals18, oneToken6, decimals6);
    expect(result).toBe("1.0000");
  });

  it("rounds down (ROUND_DOWN mode)", () => {
    // 1 / 3 = 0.33333... should be truncated to 0.3333
    const oneToken = "1000000000000000000";
    const threeTokens = "3000000000000000000";
    const result = calcExchangeRate(oneToken, decimals18, threeTokens, decimals18);
    expect(result).toBe("0.3333");
  });

  it("returns 0 on invalid inputs", () => {
    const result = calcExchangeRate("invalid", decimals18, "1000", decimals18);
    expect(result).toBe("0");
  });
});

describe("invertExchangeRate", () => {
  it("inverts a rate of 2 to 0.5", () => {
    expect(invertExchangeRate("2")).toBe("0.5000");
  });

  it("inverts a rate of 0.5 to 2", () => {
    expect(invertExchangeRate("0.5")).toBe("2.0000");
  });

  it("inverts a rate of 1 to 1", () => {
    expect(invertExchangeRate("1")).toBe("1.0000");
  });

  it("returns 0 for rate of 0 (division by zero)", () => {
    expect(invertExchangeRate("0")).toBe("0");
  });

  it("rounds down (ROUND_DOWN mode)", () => {
    // 1/3 = 0.3333...
    expect(invertExchangeRate("3")).toBe("0.3333");
  });

  it("handles string number input", () => {
    expect(invertExchangeRate("4")).toBe("0.2500");
  });
});

describe("formatBalance", () => {
  it("formats 1 token (18 decimals)", () => {
    const oneToken = "1000000000000000000";
    // ethers.formatUnits("1e18", 18) = "1.0"; slice(0, decimalIndex + 5) = "1.0"
    expect(formatBalance(oneToken, 18)).toBe("1.0");
  });

  it("formats fractional tokens", () => {
    const halfToken = "500000000000000000";
    // ethers.formatUnits returns "0.5"; no padding added
    expect(formatBalance(halfToken, 18)).toBe("0.5");
  });

  it("slices to 4 decimal places for values with many decimals", () => {
    // 1.23456789e18 → formatUnits → "1.234567890000000000" → slice to "1.2345"
    const amount = "1234500000000000000";
    expect(formatBalance(amount, 18)).toBe("1.2345");
  });

  it("returns 0 for invalid value", () => {
    expect(formatBalance("not-a-number", 18)).toBe("0");
  });

  it("formats 6-decimal token correctly", () => {
    const oneUsdc = "1000000"; // 1 USDC with 6 decimals
    // ethers.formatUnits("1000000", 6) = "1.0"
    expect(formatBalance(oneUsdc, 6)).toBe("1.0");
  });
});

describe("formatWithMaxDecimals", () => {
  it("returns 0 for empty string", () => {
    expect(formatWithMaxDecimals("")).toBe("0");
  });

  it("returns 0 for '0'", () => {
    expect(formatWithMaxDecimals("0")).toBe("0");
  });

  it("formats with default 4 decimals", () => {
    expect(formatWithMaxDecimals("1.23456789")).toBe("1.2345");
  });

  it("truncates (floors) rather than rounds", () => {
    // 1.99999 with maxDecimals=4 should floor to 1.9999
    expect(formatWithMaxDecimals("1.99999")).toBe("1.9999");
  });

  it("formats with thousand separators by default", () => {
    // Use value that avoids floating-point precision issues with *10000 multiply
    expect(formatWithMaxDecimals("1234.5678")).toBe("1,234.5678");
  });

  it("omits thousand separators when flag is false", () => {
    expect(formatWithMaxDecimals("1234.5678", 4, false)).toBe("1234.5678");
  });

  it("respects custom maxDecimals", () => {
    expect(formatWithMaxDecimals("1.23456789", 2)).toBe("1.23");
  });

  it("strips trailing zeros when no separators", () => {
    expect(formatWithMaxDecimals("1.50", 4, false)).toBe("1.5");
  });

  it("returns 0 for NaN input", () => {
    expect(formatWithMaxDecimals("abc")).toBe("0");
  });
});

describe("isValidTokenPair", () => {
  const mockToken = { symbol: "cUSD", decimals: 18, address: "0x123" };
  const mockToken2 = { symbol: "CELO", decimals: 18, address: "0x456" };

  it("returns true for a valid pair with distinct tokens", () => {
    expect(isValidTokenPair("cUSD", "CELO", mockToken, mockToken2)).toBe(true);
  });

  it("returns false when tokenInSymbol is undefined", () => {
    expect(isValidTokenPair(undefined, "CELO", mockToken, mockToken2)).toBe(false);
  });

  it("returns false when tokenOutSymbol is undefined", () => {
    expect(isValidTokenPair("cUSD", undefined, mockToken, mockToken2)).toBe(false);
  });

  it("returns false when both symbols are the same (same token swap)", () => {
    expect(isValidTokenPair("cUSD", "cUSD", mockToken, mockToken)).toBe(false);
  });

  it("returns false when fromToken is null", () => {
    expect(isValidTokenPair("cUSD", "CELO", null, mockToken2)).toBe(false);
  });

  it("returns false when toToken is null", () => {
    expect(isValidTokenPair("cUSD", "CELO", mockToken, null)).toBe(false);
  });

  it("returns false when both tokens are null", () => {
    expect(isValidTokenPair("cUSD", "CELO", null, null)).toBe(false);
  });

  it("returns false for empty string symbols", () => {
    expect(isValidTokenPair("", "CELO", mockToken, mockToken2)).toBe(false);
  });
});
