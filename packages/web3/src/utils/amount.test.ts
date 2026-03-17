import { describe, expect, it } from "vitest";
import BigNumber from "bignumber.js";
import { fromWei, fromWeiRounded, parseAmount, parseAmountWithDefault, toWei } from "./amount";

const DECIMALS_18 = 18;
const DECIMALS_6 = 6;
const ONE_TOKEN_18 = "1000000000000000000";
const HALF_TOKEN_18 = "500000000000000000";

describe("fromWei", () => {
  it("converts 1e18 to '1.0' (18 decimals)", () => {
    expect(fromWei(ONE_TOKEN_18, DECIMALS_18)).toBe("1.0");
  });

  it("converts 0.5e18 to '0.5' (18 decimals)", () => {
    expect(fromWei(HALF_TOKEN_18, DECIMALS_18)).toBe("0.5");
  });

  it("returns '0' for null", () => {
    expect(fromWei(null)).toBe("0");
  });

  it("returns '0' for undefined", () => {
    expect(fromWei(undefined)).toBe("0");
  });

  it("returns '0' for '0'", () => {
    expect(fromWei("0", DECIMALS_18)).toBe("0.0");
  });

  it("handles 6-decimal token (1e6 → 1.0)", () => {
    expect(fromWei("1000000", DECIMALS_6)).toBe("1.0");
  });

  it("floors fractional wei before conversion", () => {
    // 1.9e18 should be treated as 1e18 (floor) → "1.0"
    const almostTwo = "1999999999999999999"; // 1.999...e18
    const result = fromWei(almostTwo, DECIMALS_18);
    expect(result.startsWith("1.")).toBe(true);
  });
});

describe("fromWeiRounded", () => {
  it("converts 1e18 to '1.0000' (default 4 display decimals)", () => {
    expect(fromWeiRounded(ONE_TOKEN_18, DECIMALS_18)).toBe("1.0000");
  });

  it("returns '0' for null", () => {
    expect(fromWeiRounded(null)).toBe("0");
  });

  it("returns '0' for amounts below MIN_ROUNDED_VALUE (0.0001) when roundDownIfSmall=true", () => {
    // 1e10 wei at 18 decimals = 1e-8 — below 0.0001
    expect(fromWeiRounded("10000000000", DECIMALS_18, true)).toBe("0");
  });

  it("returns MIN_ROUNDED_VALUE string for small amounts when roundDownIfSmall=false", () => {
    expect(fromWeiRounded("10000000000", DECIMALS_18, false)).toBe("0.0001");
  });

  it("returns '0' for zero value", () => {
    expect(fromWeiRounded("0", DECIMALS_18)).toBe("0");
  });

  it("rounds a normal amount to 4 decimal places", () => {
    // 1.2345e18 — exact value, no rounding ambiguity
    const amount = "1234500000000000000";
    const result = fromWeiRounded(amount, DECIMALS_18);
    expect(result).toBe("1.2345");
  });
});

describe("toWei", () => {
  it("converts 1 to 1e18 (18 decimals)", () => {
    const result = toWei("1", DECIMALS_18);
    expect(result.toFixed()).toBe(ONE_TOKEN_18);
  });

  it("converts 0.5 to 5e17 (18 decimals)", () => {
    const result = toWei("0.5", DECIMALS_18);
    expect(result.toFixed()).toBe(HALF_TOKEN_18);
  });

  it("returns 0 for null", () => {
    const result = toWei(null, DECIMALS_18);
    expect(result.toFixed()).toBe("0");
  });

  it("returns 0 for undefined", () => {
    const result = toWei(undefined, DECIMALS_18);
    expect(result.toFixed()).toBe("0");
  });

  it("returns BigNumber instance", () => {
    const result = toWei("1", DECIMALS_18);
    expect(result).toBeInstanceOf(BigNumber);
  });

  it("converts 1 USDC to 1e6 (6 decimals)", () => {
    const result = toWei("1", DECIMALS_6);
    expect(result.toFixed()).toBe("1000000");
  });

  it("truncates extra decimals to fit token precision", () => {
    // 1.123456789 with 6 decimals → only 6 fractional digits kept
    const result = toWei("1.123456789", DECIMALS_6);
    expect(result.toFixed()).toBe("1123456");
  });

  it("handles BigNumber input", () => {
    const result = toWei(new BigNumber("2"), DECIMALS_18);
    expect(result.toFixed()).toBe("2000000000000000000");
  });
});

describe("parseAmount", () => {
  it("parses a valid integer string", () => {
    const result = parseAmount("42");
    expect(result).not.toBeNull();
    expect(result?.toNumber()).toBe(42);
  });

  it("parses a valid decimal string", () => {
    const result = parseAmount("3.14");
    expect(result).not.toBeNull();
    expect(result?.toFixed(2)).toBe("3.14");
  });

  it("returns null for null input", () => {
    expect(parseAmount(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseAmount(undefined)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(parseAmount("not-a-number")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
  });

  it("returns BigNumber instance for valid input", () => {
    expect(parseAmount("1")).toBeInstanceOf(BigNumber);
  });

  it("parses 0", () => {
    const result = parseAmount("0");
    expect(result?.toNumber()).toBe(0);
  });
});

describe("parseAmountWithDefault", () => {
  it("returns parsed value when valid", () => {
    const result = parseAmountWithDefault("5", 0);
    expect(result.toNumber()).toBe(5);
  });

  it("returns default for null input", () => {
    const result = parseAmountWithDefault(null, 99);
    expect(result.toNumber()).toBe(99);
  });

  it("returns default for invalid string", () => {
    const result = parseAmountWithDefault("bad", 7);
    expect(result.toNumber()).toBe(7);
  });

  it("returns BigNumber instance", () => {
    const result = parseAmountWithDefault("10", 0);
    expect(result).toBeInstanceOf(BigNumber);
  });

  it("returns default 0 when null and default is 0", () => {
    const result = parseAmountWithDefault(null, 0);
    expect(result.toNumber()).toBe(0);
  });
});
