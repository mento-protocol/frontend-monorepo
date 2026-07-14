import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { renderHook } from "@testing-library/react";
import type { ChainId } from "@repo/web3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const web3Mocks = vi.hoisted(() => {
  const decimal = (value: number) => ({
    gt: (other: number) => value > other,
    isZero: () => value === 0,
    lt: (other: { value: number }) => value < other.value,
    lte: (other: number) => value <= other,
    value,
  });

  return {
    formatBalance: vi.fn((value: string) => `in:${value}`),
    formatWithMaxDecimals: vi.fn((value: string) => `short:${value}`),
    fromWeiRounded: vi.fn((value: string) => `out:${value}`),
    getTokenDecimals: vi.fn(() => 18),
    MIN_ROUNDED_VALUE: 0.000001,
    parseAmount: vi.fn((value: string) => decimal(Number(value))),
    parseAmountWithDefault: vi.fn((value: string) => decimal(Number(value))),
    toWei: vi.fn((value: { value: number }) => decimal(value.value * 10)),
    useTradingLimits: vi.fn(),
    useTradingSuspensionCheck: vi.fn(),
  };
});

const tradingLimitMocks = vi.hoisted(() => ({
  checkTradingLimitViolation: vi.fn(),
}));

vi.mock("@repo/web3", () => web3Mocks);
vi.mock("./trading-limits", () => tradingLimitMocks);

import {
  getFormattedTokenInBalance,
  getFormattedTokenOutBalance,
  getTradingSuspensionError,
  hasSwapAmount,
  validateSwapBalance,
} from "./swap-form-validation";
import { useSwapFormValidation } from "./use-swap-form-validation";

const tokenInSymbol = "CELO" as TokenSymbol;
const tokenOutSymbol = "USDm" as TokenSymbol;
const chainId = 42220 as ChainId;

beforeEach(() => {
  vi.clearAllMocks();
  web3Mocks.useTradingLimits.mockReturnValue({
    data: { tokenToCheck: tokenInSymbol },
    isLoading: false,
  });
  web3Mocks.useTradingSuspensionCheck.mockReturnValue({
    isLoading: false,
    isSuspended: false,
  });
  tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(null);
});

describe("swap form balance helpers", () => {
  it("preserves the distinct sell and buy balance formatting paths", () => {
    const balances = { [tokenInSymbol]: "42" };

    expect(
      getFormattedTokenInBalance({
        balances,
        chainId: 42220,
        tokenSymbol: tokenInSymbol,
      }),
    ).toBe("short:in:42");
    expect(
      getFormattedTokenOutBalance({
        balances,
        chainId: 42220,
        tokenSymbol: tokenInSymbol,
      }),
    ).toBe("short:out:42");
  });

  it.each([
    ["", false],
    ["0", false],
    ["0.", false],
    ["0.00", false],
    ["1", true],
    ["not-a-number", false],
  ])("characterizes amount presence for %s", (amount, expected) => {
    expect(hasSwapAmount(amount)).toBe(expected);
  });
});

describe("validateSwapBalance", () => {
  const allTokenOptions = [{ decimals: 1, symbol: tokenInSymbol }];

  it("preserves each current validation message", () => {
    expect(
      validateSwapBalance({
        allTokenOptions,
        balances: {},
        tokenInSymbol,
        value: "0.0000001",
      }),
    ).toBe("Amount too small");
    expect(
      validateSwapBalance({
        allTokenOptions: [],
        balances: {},
        tokenInSymbol,
        value: "1",
      }),
    ).toBe("Invalid token");
    expect(
      validateSwapBalance({
        allTokenOptions,
        balances: {},
        tokenInSymbol,
        value: "1",
      }),
    ).toBe("Balance unavailable");
    expect(
      validateSwapBalance({
        allTokenOptions,
        balances: { [tokenInSymbol]: "5" },
        tokenInSymbol,
        value: "1",
      }),
    ).toBe("Insufficient balance");
  });

  it("accepts an amount covered by the token balance", () => {
    expect(
      validateSwapBalance({
        allTokenOptions,
        balances: { [tokenInSymbol]: "20" },
        tokenInSymbol,
        value: "1",
      }),
    ).toBe(true);
  });
});

describe("getTradingSuspensionError", () => {
  it("returns the current token-pair message only while suspended", () => {
    expect(
      getTradingSuspensionError({
        isTradingSuspended: true,
        tokenInSymbol: "CELO",
        tokenOutSymbol: "USDm",
      }),
    ).toBe(
      "Trading temporarily paused for CELO -> USDm. Unable to determine accurate exchange rate now. Please try again later.",
    );
    expect(
      getTradingSuspensionError({
        isTradingSuspended: false,
        tokenInSymbol: "CELO",
        tokenOutSymbol: "USDm",
      }),
    ).toBeNull();
  });
});

describe("useSwapFormValidation", () => {
  const renderValidation = () =>
    renderHook(() =>
      useSwapFormValidation({
        allTokenOptions: [{ decimals: 1, symbol: tokenInSymbol }],
        amount: "1",
        balances: { [tokenInSymbol]: "20" },
        chainId,
        formQuote: "2",
        hasAmountError: false,
        selectedTokenInSymbol: tokenInSymbol,
        selectedTokenOutSymbol: tokenOutSymbol,
        tokenInSymbol,
        tokenOutSymbol,
      }),
    );

  it("preserves the valid quote and composed amount-validation path", async () => {
    const { result } = renderValidation();

    expect(result.current.canQuote).toBe(true);
    expect(result.current.hasAmount).toBe(true);
    await expect(result.current.validateAmount("1")).resolves.toBe(true);
    expect(tradingLimitMocks.checkTradingLimitViolation).toHaveBeenCalledWith(
      expect.objectContaining({ tokenInSymbol, tokenOutSymbol }),
    );
  });

  it("surfaces the current trading-limit message through validateAmount", async () => {
    tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(
      "Limit reached",
    );
    const { result } = renderValidation();

    await expect(result.current.validateAmount("1")).resolves.toBe(
      "Limit reached",
    );
  });

  it("blocks quotes and exposes the pair message while trading is suspended", () => {
    web3Mocks.useTradingSuspensionCheck.mockReturnValue({
      isLoading: false,
      isSuspended: true,
    });
    const { result } = renderValidation();

    expect(result.current.canQuote).toBe(false);
    expect(result.current.tradingSuspensionError).toContain(
      "Trading temporarily paused for CELO -> USDm",
    );
  });
});
