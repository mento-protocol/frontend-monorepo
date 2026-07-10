import { beforeEach, describe, expect, it, vi } from "vitest";

const formatterMocks = vi.hoisted(() => ({
  formatBalance: vi.fn(
    (balanceInWei: string, decimals: number) => `${balanceInWei}:${decimals}`,
  ),
  formatWithMaxDecimals: vi.fn(
    (
      formattedAmount: string,
      maxDecimals: number,
      useThousandSeparators: boolean,
    ) => `${formattedAmount}:${maxDecimals}:${useThousandSeparators}`,
  ),
}));

vi.mock("@repo/web3", () => formatterMocks);

import { getMaxSellAmount } from "./max-sell-amount";

describe("getMaxSellAmount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the native gas reserve when the balance exceeds 0.01 CELO", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "1234567890000000000",
        decimals: 18,
        isNativeToken: true,
      }),
    ).toBe("1224567890000000000:18:4:false");
    expect(formatterMocks.formatBalance).toHaveBeenCalledWith(
      "1224567890000000000",
      18,
    );
  });

  it("does not subtract the reserve when the native balance is at or below 0.01 CELO", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "10000000000000000",
        decimals: 18,
        isNativeToken: true,
      }),
    ).toBe("10000000000000000:18:4:false");
    expect(formatterMocks.formatBalance).toHaveBeenCalledWith(
      "10000000000000000",
      18,
    );

    vi.clearAllMocks();

    expect(
      getMaxSellAmount({
        balanceInWei: "9999999999999999",
        decimals: 18,
        isNativeToken: true,
      }),
    ).toBe("9999999999999999:18:4:false");
    expect(formatterMocks.formatBalance).toHaveBeenCalledWith(
      "9999999999999999",
      18,
    );
  });

  it("passes non-native balances through unchanged", () => {
    expect(
      getMaxSellAmount({
        balanceInWei: "1234567890000000000",
        decimals: 18,
        isNativeToken: false,
      }),
    ).toBe("1234567890000000000:18:4:false");
    expect(formatterMocks.formatBalance).toHaveBeenCalledWith(
      "1234567890000000000",
      18,
    );
  });

  it("formats the balance with four decimals and no thousand separators", () => {
    formatterMocks.formatBalance.mockReturnValueOnce("123456.78912345");
    formatterMocks.formatWithMaxDecimals.mockReturnValueOnce("123456.7891");

    const result = getMaxSellAmount({
      balanceInWei: "123456789123456789123456",
      decimals: 18,
      isNativeToken: false,
    });

    expect(result).toBe("123456.7891");
    expect(formatterMocks.formatWithMaxDecimals).toHaveBeenCalledWith(
      "123456.78912345",
      4,
      false,
    );
  });
});
