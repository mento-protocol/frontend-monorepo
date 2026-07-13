import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  calcExchangeRate,
  formatBalance,
  formatWithMaxDecimals,
  isValidTokenPair,
  parseInputExchangeAmount,
  parseSlippage,
} from "./utils";

type TokenArg = Parameters<typeof isValidTokenPair>[2];

function makeToken(symbol: string): TokenArg {
  return { symbol } as unknown as TokenArg;
}

const CELO_CHAIN_ID = 42220;

describe("calcExchangeRate", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rates a 6-decimal token against an 18-decimal token", () => {
    expect(calcExchangeRate("1000000", 6, "2000000000000000000", 18)).toBe(
      "0.5000",
    );
  });

  it("rates two 18-decimal tokens", () => {
    expect(
      calcExchangeRate("1000000000000000000", 18, "2000000000000000000", 18),
    ).toBe("0.5000");
  });

  it("rounds down to four decimals", () => {
    expect(
      calcExchangeRate("1000000000000000000", 18, "3000000000000000000", 18),
    ).toBe("0.3333");
  });

  it("returns '0' when the destination amount is zero (Infinity path)", () => {
    expect(calcExchangeRate("1000000000000000000", 18, "0", 18)).toBe("0");
  });

  it("returns '0' and warns on unparseable input (catch path)", () => {
    expect(calcExchangeRate("garbage", 18, "1", 18)).toBe("0");
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("parseInputExchangeAmount", () => {
  it("returns '0' for null", () => {
    expect(
      parseInputExchangeAmount(null, TokenSymbol.USDm, CELO_CHAIN_ID),
    ).toBe("0");
  });

  it("clamps negative amounts to '0'", () => {
    expect(
      parseInputExchangeAmount("-5", TokenSymbol.USDm, CELO_CHAIN_ID),
    ).toBe("0");
  });

  it("converts a decimal amount to 18-decimal wei", () => {
    expect(
      parseInputExchangeAmount("1.5", TokenSymbol.USDm, CELO_CHAIN_ID),
    ).toBe("1500000000000000000");
  });

  it("passes a wei value through unchanged when isWei is true", () => {
    expect(
      parseInputExchangeAmount(
        "1500000000000000000",
        TokenSymbol.USDm,
        CELO_CHAIN_ID,
        true,
      ),
    ).toBe("1500000000000000000");
  });
});

describe("formatWithMaxDecimals", () => {
  it("truncates to four decimals with thousand separators", () => {
    expect(formatWithMaxDecimals("1234.56789")).toBe("1,234.5678");
  });

  it("strips trailing zeros without separators (form input branch)", () => {
    expect(formatWithMaxDecimals("0.30000", 4, false)).toBe("0.3");
  });

  it("returns '0' for empty, '0', and NaN inputs", () => {
    expect(formatWithMaxDecimals("")).toBe("0");
    expect(formatWithMaxDecimals("0")).toBe("0");
    expect(formatWithMaxDecimals("abc")).toBe("0");
  });

  it("preserves >15-significant-digit integers without precision loss", () => {
    expect(formatWithMaxDecimals("999999999999999999")).toBe(
      "999,999,999,999,999,999",
    );
  });

  it("does not round 4.35 down to 4.34", () => {
    expect(formatWithMaxDecimals("4.35", 2)).toBe("4.35");
  });

  it("preserves a high-precision decimal without separators", () => {
    expect(formatWithMaxDecimals("123456789012345678.1234", 4, false)).toBe(
      "123456789012345678.1234",
    );
  });
});

describe("parseSlippage", () => {
  const fallbackCases: Array<{ name: string; input: string | undefined }> = [
    { name: "non-numeric", input: "garbage" },
    { name: "empty string", input: "" },
    { name: "undefined", input: undefined },
    { name: "negative", input: "-1" },
    { name: "zero", input: "0" },
    { name: "above the max", input: "25" },
  ];

  it.each(fallbackCases)("returns the default 0.3 for $name", ({ input }) => {
    expect(parseSlippage(input)).toBe(0.3);
  });

  it("returns a valid in-range value", () => {
    expect(parseSlippage("0.5")).toBe(0.5);
  });

  it("accepts the max boundary value", () => {
    expect(parseSlippage("20")).toBe(20);
  });
});

describe("formatBalance", () => {
  it("keeps up to four decimal places", () => {
    expect(formatBalance("1234567890000000000", 18)).toBe("1.2345");
  });

  it("formats a value with fewer than four decimals unchanged", () => {
    expect(formatBalance("1500000000000000000", 18)).toBe("1.5");
  });

  it("returns '0' for unparseable input", () => {
    expect(formatBalance("garbage", 18)).toBe("0");
  });
});

describe("isValidTokenPair", () => {
  const usdc = makeToken("USDC");
  const usdm = makeToken("USDm");

  it("returns true for two distinct tokens", () => {
    expect(isValidTokenPair("USDC", "USDm", usdc, usdm)).toBe(true);
  });

  it("returns false when the symbols are identical", () => {
    expect(isValidTokenPair("USDC", "USDC", usdc, usdc)).toBe(false);
  });

  it("returns false when a token object is missing", () => {
    expect(isValidTokenPair("USDC", "USDm", null, usdm)).toBe(false);
    expect(isValidTokenPair("USDC", "USDm", usdc, null)).toBe(false);
  });

  it("returns false when a symbol is undefined", () => {
    expect(isValidTokenPair(undefined, "USDm", usdc, usdm)).toBe(false);
  });
});
