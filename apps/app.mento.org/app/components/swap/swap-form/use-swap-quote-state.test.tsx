import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { renderHook } from "@testing-library/react";
import type { ChainId } from "@repo/web3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SwapTradingLimits } from "./trading-limits";

const web3Mocks = vi.hoisted(() => ({
  getTokenDecimals: vi.fn(() => 18),
  parseAmount: vi.fn(),
  parseAmountWithDefault: vi.fn((value) => ({ value })),
  toWei: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
}));
const tradingLimitMocks = vi.hoisted(() => ({
  checkTradingLimitViolation: vi.fn(),
}));

vi.mock("@repo/web3", () => web3Mocks);
vi.mock("sonner", () => ({ toast: toastMocks }));
vi.mock("./trading-limits", () => tradingLimitMocks);

import { useSwapQuoteState } from "./use-swap-quote-state";

const chainId = 42220 as ChainId;
const celo = "CELO" as TokenSymbol;
const usdM = "USDm" as TokenSymbol;
const noLimits: SwapTradingLimits = {
  L0: null,
  L1: null,
  LG: null,
  tokenToCheck: null,
};
type QuoteStateProps = Parameters<typeof useSwapQuoteState>[0];

function createProps(
  overrides: Partial<QuoteStateProps> = {},
): QuoteStateProps {
  return {
    amount: "1.25",
    canQuote: true,
    chainId,
    formQuote: "2.5",
    fromTokenUSDValue: "4.5",
    hasAmount: true,
    isQuoteError: false,
    isTradingSuspended: false,
    limits: null,
    limitsLoading: false,
    prevTradingSuspensionErrorRef: { current: null },
    quote: "2.5",
    quoteFetching: true,
    selectedTokenInSymbol: celo,
    selectedTokenOutSymbol: usdM,
    suspensionToastIdRef: { current: null },
    toTokenUSDValue: "2.5",
    tokenInSymbol: "CELO",
    tokenOutSymbol: "USDm",
    tradingSuspensionError: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const parsedAmount = { gt: vi.fn(() => true) };
  web3Mocks.parseAmount.mockReturnValue(parsedAmount);
  web3Mocks.toWei.mockReturnValue({
    toFixed: vi.fn(() => "1250000000000000000"),
  });
  tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(null);
});

describe("useSwapQuoteState", () => {
  it("derives loading, USD values, and the positive input amount in wei", () => {
    const props = createProps();
    const { result, rerender } = renderHook(
      (hookProps: QuoteStateProps) => useSwapQuoteState(hookProps),
      { initialProps: props },
    );

    expect(result.current).toEqual({
      amountInWei: "1250000000000000000",
      buyUSDValue: "2.5",
      isButtonLoading: true,
      isLoading: true,
      sellUSDValue: "4.5",
      tradingLimitError: null,
    });
    expect(web3Mocks.parseAmount).toHaveBeenCalledWith("1.25");
    expect(web3Mocks.getTokenDecimals).toHaveBeenCalledWith(celo, chainId);
    expect(web3Mocks.toWei).toHaveBeenCalledWith(
      web3Mocks.parseAmount.mock.results[0]?.value,
      18,
    );

    rerender({
      ...props,
      amount: "3",
      fromTokenUSDValue: "ignored",
      toTokenUSDValue: "6.75",
      tokenInSymbol: "USDm",
      tokenOutSymbol: "CELO",
    });
    expect(result.current.sellUSDValue).toBe("3");
    expect(result.current.buyUSDValue).toBe("6.75");
  });

  it("surfaces a trading-limit violation, blocks loading, and shows its toast", () => {
    tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(
      "Trading limit exceeded",
    );

    const { result } = renderHook(() =>
      useSwapQuoteState(createProps({ limits: noLimits })),
    );

    expect(result.current.tradingLimitError).toBe("Trading limit exceeded");
    expect(result.current.isLoading).toBe(false);
    expect(tradingLimitMocks.checkTradingLimitViolation).toHaveBeenCalledWith({
      amountIn: { value: "1.25" },
      amountOut: { value: "2.5" },
      limits: noLimits,
      tokenInSymbol: "CELO",
      tokenOutSymbol: "USDm",
    });
    expect(toastMocks.error).toHaveBeenCalledWith("Trading limit exceeded", {
      duration: 20000,
    });
  });

  it("replaces a changed suspension toast and dismisses it when the error clears", () => {
    toastMocks.error.mockReturnValueOnce(101).mockReturnValueOnce(102);
    const prevErrorRef = { current: null as string | null };
    const toastIdRef = { current: null as string | number | null };
    const props = createProps({
      prevTradingSuspensionErrorRef: prevErrorRef,
      quoteFetching: false,
      suspensionToastIdRef: toastIdRef,
    });
    const { rerender } = renderHook(
      (hookProps: QuoteStateProps) => useSwapQuoteState(hookProps),
      { initialProps: props },
    );

    rerender({ ...props, tradingSuspensionError: "Suspended" });
    expect(toastMocks.error).toHaveBeenLastCalledWith("Suspended", {
      duration: 20000,
    });
    expect(prevErrorRef.current).toBe("Suspended");
    expect(toastIdRef.current).toBe(101);

    rerender({ ...props, tradingSuspensionError: "Still suspended" });
    expect(toastMocks.dismiss).toHaveBeenCalledWith(101);
    expect(toastMocks.error).toHaveBeenLastCalledWith("Still suspended", {
      duration: 20000,
    });
    expect(prevErrorRef.current).toBe("Still suspended");
    expect(toastIdRef.current).toBe(102);

    rerender({ ...props, tradingSuspensionError: null });
    expect(toastMocks.dismiss).toHaveBeenLastCalledWith(102);
    expect(prevErrorRef.current).toBeNull();
    expect(toastIdRef.current).toBeNull();
  });
});
