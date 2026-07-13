import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/web3", () => ({
  parseAmount: (value: string) => ({ isNegative: () => value.startsWith("-") }),
}));

import {
  getSwapFormInitialState,
  sanitizeRouteAmount,
  useStableRouteDrivenFormState,
} from "./swap-form-initial-state";

const tokenInSymbol = "USDm" as TokenSymbol;
const tokenOutSymbol = "CELO" as TokenSymbol;
const availableTokens = [tokenInSymbol, tokenOutSymbol];

describe("sanitizeRouteAmount", () => {
  it.each([undefined, "", " ", "-1", "1e3", "1.2.3"])(
    "rejects invalid route amount %s",
    (value) => expect(sanitizeRouteAmount(value)).toBe(""),
  );

  it("preserves valid route formatting after trimming whitespace", () => {
    expect(sanitizeRouteAmount("  .50 ")).toBe(".50");
  });
});

describe("getSwapFormInitialState", () => {
  it("reuses a stored draft only when no URL state takes precedence", () => {
    const state = getSwapFormInitialState({
      availableTokens,
      formValues: {
        amount: "12",
        quote: "34",
        slippage: "0.5",
        tokenInSymbol,
        tokenOutSymbol,
      },
      preferredQuoteTokenSymbol: tokenInSymbol,
    });

    expect(state.defaultValues).toEqual({
      amount: "12",
      quote: "34",
      slippage: "0.5",
      tokenInSymbol,
      tokenOutSymbol,
    });
    expect(state.routeDrivenFormState).toEqual({
      amount: "12",
      tokenInSymbol,
      tokenOutSymbol,
    });
  });

  it("uses valid URL state instead of the stored draft", () => {
    const state = getSwapFormInitialState({
      availableTokens,
      formValues: {
        amount: "12",
        quote: "34",
        slippage: "0.5",
        tokenInSymbol: tokenOutSymbol,
        tokenOutSymbol: tokenInSymbol,
      },
      options: {
        initialAmount: " 7.5 ",
        initialFrom: tokenInSymbol,
        initialTo: tokenOutSymbol,
      },
      preferredQuoteTokenSymbol: tokenInSymbol,
    });

    expect(state.defaultValues).toEqual({
      amount: "7.5",
      quote: "",
      slippage: "0.5",
      tokenInSymbol,
      tokenOutSymbol,
    });
  });

  it("clears an amount whose requested route token is unavailable", () => {
    const state = getSwapFormInitialState({
      availableTokens,
      formValues: null,
      options: { initialAmount: "7.5", initialFrom: "not-a-token" },
      preferredQuoteTokenSymbol: tokenInSymbol,
    });

    expect(state.defaultValues.amount).toBe("");
    expect(state.defaultValues.tokenInSymbol).toBe(state.initialTokenInSymbol);
    expect(state.defaultValues.tokenOutSymbol).toBe("");
  });
});

describe("useStableRouteDrivenFormState", () => {
  it("keeps route state identity stable until a route value changes", () => {
    const { result, rerender } = renderHook(
      ({ amount }) =>
        useStableRouteDrivenFormState(amount, tokenInSymbol, tokenOutSymbol),
      { initialProps: { amount: "1" } },
    );
    const initialState = result.current;

    rerender({ amount: "1" });
    expect(result.current).toBe(initialState);

    rerender({ amount: "2" });
    expect(result.current).toEqual({
      amount: "2",
      tokenInSymbol,
      tokenOutSymbol,
    });
    expect(result.current).not.toBe(initialState);
  });
});
