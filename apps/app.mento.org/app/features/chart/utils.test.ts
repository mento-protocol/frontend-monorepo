import { STALE_TOKEN_PRICE_TIME } from "@/lib/config/consts";
import { TokenId } from "@/lib/config/tokens";
import { QuoteCurrencyPriceHistory } from "@/features/chart/types";
import {
  findMissingPriceDays,
  mergePriceHistories,
} from "@/features/chart/utils";
import { nowMinusDays } from "src/test/time";

function pricePoint(day: number, price: number) {
  return { timestamp: nowMinusDays(day), price };
}

const OLD_PRICES: QuoteCurrencyPriceHistory = {
  [TokenId.cUSD]: [
    pricePoint(0, 1.0),
    pricePoint(1, 1.1),
    pricePoint(2, 1.2),
    pricePoint(4, 1.4),
    pricePoint(20, 2.0),
    pricePoint(21, 2.1),
  ],
};

describe("finds missing days", () => {
  it("Finds all for empty set", () => {
    const days = findMissingPriceDays(3);
    expect(days).toEqual([0, 1, 2]);
  });
  it("Finds nothing for full set", () => {
    const days = findMissingPriceDays(3, OLD_PRICES);
    expect(days).toEqual([]);
  });
  it("Finds one for nearly full set", () => {
    const days = findMissingPriceDays(4, OLD_PRICES);
    expect(days).toEqual([3]);
  });
  it("Finds holes in data", () => {
    const days = findMissingPriceDays(5, OLD_PRICES);
    expect(days).toEqual([3]);
  });
  it("Excludes stale from today", () => {
    const prices: QuoteCurrencyPriceHistory = {
      [TokenId.cUSD]: [
        { timestamp: Date.now() - STALE_TOKEN_PRICE_TIME * 1.5, price: 1.0 },
        pricePoint(1, 1.1),
        pricePoint(2, 1.2),
      ],
    };
    const days = findMissingPriceDays(3, prices);
    expect(days).toEqual([0]);
  });
});

describe("merges price histories", () => {
  it("Merges without overlap", () => {
    const newPrices: QuoteCurrencyPriceHistory = {
      [TokenId.cUSD]: [pricePoint(3, 1.3)],
    };
    const merged = mergePriceHistories(newPrices, OLD_PRICES);
    const mergedUsd = merged[TokenId.cUSD];
    if (!mergedUsd) throw new Error("invalid merge result");
    expect(mergedUsd.length).toEqual(5);
    expect(mergedUsd[mergedUsd.length - 1].price).toEqual(1.3);
  });
  it("Merges with overlap", () => {
    const newPrices: QuoteCurrencyPriceHistory = {
      [TokenId.cUSD]: [pricePoint(0, 2.0), pricePoint(3, 1.3)],
    };
    const merged = mergePriceHistories(newPrices, OLD_PRICES);
    const mergedUsd = merged[TokenId.cUSD];
    if (!mergedUsd) throw new Error("invalid merge result");
    expect(mergedUsd.length).toEqual(5);
    expect(mergedUsd[mergedUsd.length - 2].price).toEqual(2.0);
  });
  it("Merges with no old prices", () => {
    const merged = mergePriceHistories(OLD_PRICES);
    const mergedUsd = merged[TokenId.cUSD];
    if (!mergedUsd) throw new Error("invalid merge result");
    expect(mergedUsd.length).toEqual(OLD_PRICES[TokenId.cUSD]!.length);
  });
});
