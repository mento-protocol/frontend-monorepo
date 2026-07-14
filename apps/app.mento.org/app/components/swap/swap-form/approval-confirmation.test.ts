import { describe, expect, it } from "vitest";

import { isCurrentSwapQuote } from "./approval-confirmation";

const currentQuote = {
  amountInWei: "1000000000000000000",
  formQuote: "0.7421",
  formattedQuote: "0.7421",
  isFetching: false,
  quote: "0.742123",
  quotedAmountInWei: "1000000000000000000",
};

describe("isCurrentSwapQuote", () => {
  it("accepts a settled quote for the exact current input", () => {
    expect(isCurrentSwapQuote(currentQuote)).toBe(true);
  });

  it("rejects a quote for the previous input amount", () => {
    expect(
      isCurrentSwapQuote({
        ...currentQuote,
        quotedAmountInWei: "1100000000000000000",
      }),
    ).toBe(false);
  });

  it("rejects a quote that has not synchronized into the form", () => {
    expect(isCurrentSwapQuote({ ...currentQuote, formQuote: "0.8163" })).toBe(
      false,
    );
  });

  it("rejects a quote while a refresh is in flight", () => {
    expect(isCurrentSwapQuote({ ...currentQuote, isFetching: true })).toBe(
      false,
    );
  });
});
