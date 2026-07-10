import { describe, expect, it } from "vitest";

import { getMaxSellAmount } from "./max-sell-amount";

describe("getMaxSellAmount", () => {
  it("applies the native gas reserve when the balance exceeds 0.01 CELO", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "1234567890000000000",
        decimals: 18,
        isNativeToken: true,
      }),
    ).toBe("1.2245");
  });

  it("does not subtract the reserve when the native balance is at or below 0.01 CELO", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "10000000000000000",
        decimals: 18,
        isNativeToken: true,
      }),
    ).toBe("0.01");
  });

  it("passes non-native balances through unchanged", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "1234567890000000000",
        decimals: 18,
        isNativeToken: false,
      }),
    ).toBe("1.2345");
  });

  it("truncates to four decimals without thousand separators", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "123456789123456789123456",
        decimals: 18,
        isNativeToken: false,
      }),
    ).toBe("123456.7891");
  });
});
