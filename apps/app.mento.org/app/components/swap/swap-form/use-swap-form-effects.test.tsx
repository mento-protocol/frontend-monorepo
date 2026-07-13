import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { renderHook } from "@testing-library/react";
import type { ChainId, SwapFormValues } from "@repo/web3";
import type { FieldError, UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LastChangedToken } from "./route-driven-state";
import type { FormValues } from "./types";

const web3Mocks = vi.hoisted(() => ({
  formatWithMaxDecimals: vi.fn(),
  useTradablePairs: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@repo/web3", () => web3Mocks);
vi.mock("sonner", () => ({ toast: toastMocks }));

import {
  useSwapQuoteFormEffects,
  useSwapTokenPairEffects,
} from "./use-swap-form-effects";

const chainId = 42220 as ChainId;
const celo = "CELO" as TokenSymbol;
const eurM = "EURm" as TokenSymbol;
const gbpM = "GBPm" as TokenSymbol;
const usdM = "USDm" as TokenSymbol;

function createFormHarness() {
  const reset = vi.fn();
  const setValue = vi.fn();
  const form = { reset, setValue } as unknown as UseFormReturn<FormValues>;
  return { form, reset, setValue };
}

function createAmountError(message: string): FieldError {
  return { message, type: "validate" };
}

beforeEach(() => {
  vi.clearAllMocks();
  web3Mocks.formatWithMaxDecimals.mockImplementation(
    (value) => `formatted:${value}`,
  );
  web3Mocks.useTradablePairs.mockReturnValue({
    data: [],
    isLoading: false,
  });
});

describe("useSwapQuoteFormEffects", () => {
  it("synchronizes formatted quotes and only toasts actionable amount errors", () => {
    const { form, setValue } = createFormHarness();
    const props = {
      amount: "1",
      amountError: createAmountError("Balance is too low"),
      form,
      formQuote: "",
      hasAmount: true,
      quote: "2.34567",
    };
    const { rerender } = renderHook(
      (hookProps: Parameters<typeof useSwapQuoteFormEffects>[0]) =>
        useSwapQuoteFormEffects(hookProps),
      { initialProps: props },
    );

    expect(web3Mocks.formatWithMaxDecimals).toHaveBeenCalledWith(
      "2.34567",
      4,
      false,
    );
    expect(setValue).toHaveBeenCalledWith("quote", "formatted:2.34567", {
      shouldValidate: true,
    });
    expect(toastMocks.error).toHaveBeenCalledWith("Balance is too low");

    setValue.mockClear();
    toastMocks.error.mockClear();
    rerender({
      ...props,
      amount: "2",
      amountError: createAmountError("Invalid input"),
      formQuote: "formatted:2.34567",
    });
    rerender({
      ...props,
      amount: "3",
      amountError: createAmountError("Amount is required"),
      formQuote: "formatted:2.34567",
    });
    rerender({
      ...props,
      amount: "4",
      amountError: createAmountError("Balance is too low"),
      formQuote: "formatted:2.34567",
      hasAmount: false,
    });

    expect(setValue).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});

describe("useSwapTokenPairEffects", () => {
  it("resets quote and amount after a successful swap while preserving form preferences", () => {
    const { form, reset } = createFormHarness();
    const setLastChangedToken = vi.fn();
    const formValues: SwapFormValues = {
      amount: "",
      quote: "2.5",
      slippage: "0.75",
      tokenInSymbol: celo,
      tokenOutSymbol: eurM,
    };

    renderHook(() =>
      useSwapTokenPairEffects({
        chainId,
        form,
        formValues,
        lastChangedTokenRef: { current: null },
        selectedTokenInSymbol: celo,
        selectedTokenOutSymbol: eurM,
        setLastChangedToken,
      }),
    );

    expect(web3Mocks.useTradablePairs).toHaveBeenNthCalledWith(
      1,
      celo,
      chainId,
    );
    expect(web3Mocks.useTradablePairs).toHaveBeenNthCalledWith(
      2,
      eurM,
      chainId,
    );
    expect(setLastChangedToken).toHaveBeenCalledWith(null);
    expect(reset).toHaveBeenCalledWith({
      amount: "",
      quote: "",
      slippage: "0.75",
      tokenInSymbol: celo,
      tokenOutSymbol: eurM,
    });
  });

  it.each([
    ["from", "tokenOutSymbol"],
    ["to", "tokenInSymbol"],
  ] as const)(
    "clears the opposite token when the last-changed %s token creates an invalid pair",
    (lastChangedToken, fieldToClear) => {
      web3Mocks.useTradablePairs.mockImplementation((symbol) => ({
        data: symbol === celo ? [gbpM] : [eurM],
        isLoading: false,
      }));
      const { form, reset, setValue } = createFormHarness();
      const setLastChangedToken = vi.fn();
      const lastChangedTokenRef = {
        current: lastChangedToken as LastChangedToken,
      };

      renderHook(() =>
        useSwapTokenPairEffects({
          chainId,
          form,
          formValues: { amount: "1", slippage: "0.3" },
          lastChangedTokenRef,
          selectedTokenInSymbol: celo,
          selectedTokenOutSymbol: usdM,
          setLastChangedToken,
        }),
      );

      expect(reset).not.toHaveBeenCalled();
      expect(setValue).toHaveBeenCalledWith(fieldToClear, "", {
        shouldValidate: false,
      });
      expect(setLastChangedToken).toHaveBeenCalledWith(null);
    },
  );
});
