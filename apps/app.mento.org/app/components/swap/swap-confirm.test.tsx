/**
 * Tests that SwapConfirm quotes and executes on the ROUTE chain (its `chainId`
 * prop), not the wallet chain, and blocks execution on a wallet/route mismatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const CELO = 42220;
const CELO_SEPOLIA = 11142220;
const ACCOUNT = "0x1234567890123456789012345678901234567890";

// Hoisted spies so the mock factories and the test share the same instances.
const hooks = vi.hoisted(() => ({
  useOptimizedSwapQuote: vi.fn(),
  useSwapTransaction: vi.fn(),
  useSwapAllowance: vi.fn(),
  useGasEstimation: vi.fn(),
  useAccountBalances: vi.fn(),
  useTokenOptions: vi.fn(),
  useTradingLimits: vi.fn(),
  useChainId: vi.fn(),
}));
const tradingLimitMocks = vi.hoisted(() => ({
  checkTradingLimitViolation: vi.fn(),
}));
const refetchMocks = vi.hoisted(() => ({
  limits: vi.fn(),
  quote: vi.fn(),
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  TokenSymbol: { USDm: "USDm", USDC: "USDC", CELO: "CELO" },
}));

vi.mock("@/env.mjs", () => ({
  env: { NEXT_PUBLIC_BANNER_LINK: "https://example.test" },
}));

vi.mock("@/components/shared/chain-mismatch-banner", () => ({
  ChainMismatchBanner: () =>
    React.createElement("div", { "data-testid": "chain-mismatch-banner" }),
}));

vi.mock("./insufficient-liquidity-notice", () => ({
  SwapInsufficientLiquidityNotice: () => null,
}));

vi.mock("./swap-form/trading-limits", () => tradingLimitMocks);

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => React.createElement("button", { onClick, ...rest }, children),
  IconLoading: () => null,
  TokenIcon: () => null,
}));

vi.mock("@repo/web3", async () => {
  const { atom } = await import("jotai");
  return {
    formValuesAtom: atom({
      amount: "1",
      tokenInSymbol: "USDC",
      tokenOutSymbol: "CELO",
      slippage: "0.3",
      deadlineMinutes: "5",
    }),
    getNativeTokenSymbol: () => "CELO",
    formatWithMaxDecimals: (value: string) => value,
    isInsufficientLiquidityError: () => false,
    SWAP_INSUFFICIENT_LIQUIDITY_LABEL: "Insufficient liquidity",
    TRADING_LIMITS_UNAVAILABLE_MESSAGE:
      "Unable to verify trading limits. Please try again.",
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    useAccountBalances: hooks.useAccountBalances,
    useTokenOptions: hooks.useTokenOptions,
    useOptimizedSwapQuote: hooks.useOptimizedSwapQuote,
    useSwapAllowance: hooks.useSwapAllowance,
    useSwapTransaction: hooks.useSwapTransaction,
    useGasEstimation: hooks.useGasEstimation,
    useTradingLimits: hooks.useTradingLimits,
  };
});

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: ACCOUNT, isConnected: true }),
  useChainId: () => hooks.useChainId(),
  useSwitchChain: () => ({ switchChainAsync: vi.fn() }),
}));

import { SwapConfirm } from "./swap-confirm";

type SwapConfirmChainId = Parameters<typeof SwapConfirm>[0]["chainId"];

function renderConfirm(chainId: number) {
  return render(
    React.createElement(SwapConfirm, {
      chainId: chainId as SwapConfirmChainId,
    }),
  );
}

beforeEach(() => {
  hooks.useOptimizedSwapQuote.mockReturnValue({
    amountWei: "100",
    quote: "1",
    rate: "1",
    isFetching: false,
    isError: false,
    hasInsufficientLiquidityError: false,
    quoteErrorMessage: null,
    routeAmounts: ["1", "1"],
    refetch: refetchMocks.quote,
    fromTokenUSDValue: "1",
    toTokenUSDValue: "1",
  });
  hooks.useSwapTransaction.mockReturnValue({
    sendSwapTx: vi.fn(),
    isSwapTxLoading: false,
    isSwapTxReceiptLoading: false,
  });
  hooks.useSwapAllowance.mockReturnValue({
    skipApprove: true,
    isAllowanceLoading: false,
  });
  hooks.useGasEstimation.mockReturnValue({
    data: {
      totalFeeFormatted: "0.01",
      totalFeeUSD: "0.007",
    },
    isLoading: false,
    error: null,
  });
  hooks.useAccountBalances.mockReturnValue({ data: undefined });
  hooks.useTokenOptions.mockReturnValue({ allTokenOptions: [] });
  hooks.useTradingLimits.mockReturnValue({
    data: [],
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: refetchMocks.limits,
  });
  refetchMocks.quote.mockResolvedValue({
    data: { routeAmounts: ["1", "1"] },
    error: null,
    isError: false,
  });
  refetchMocks.limits.mockResolvedValue({
    data: [],
    error: null,
    isError: false,
  });
  tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SwapConfirm chain threading", () => {
  it("quotes on the route chainId, not the wallet chain", () => {
    hooks.useChainId.mockReturnValue(CELO_SEPOLIA);
    renderConfirm(CELO);

    const quoteCall = hooks.useOptimizedSwapQuote.mock.calls[0];
    const options = quoteCall?.[3];
    expect(options?.chainId).toBe(CELO);
  });

  it("executes the transaction on the route chainId", () => {
    hooks.useChainId.mockReturnValue(CELO_SEPOLIA);
    renderConfirm(CELO);

    const txCall = hooks.useSwapTransaction.mock.calls[0];
    expect(txCall?.[0]).toBe(CELO);
  });

  it("threads skipApprove from useSwapAllowance as isApproveConfirmed (not literal true)", () => {
    hooks.useSwapAllowance.mockReturnValue({
      skipApprove: false,
      isAllowanceLoading: false,
    });
    hooks.useChainId.mockReturnValue(CELO);
    renderConfirm(CELO);

    const txCall = hooks.useSwapTransaction.mock.calls[0];
    // Sixth positional argument is isApproveConfirmed.
    expect(txCall?.[5]).toBe(false);
  });

  it("disables the Swap button when the wallet is on a different chain", () => {
    hooks.useChainId.mockReturnValue(CELO_SEPOLIA);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables the Swap button when the wallet is on the route chain", () => {
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("disables the Swap button while approval is not confirmed", () => {
    hooks.useSwapAllowance.mockReturnValue({
      skipApprove: false,
      isAllowanceLoading: false,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows a known trading-limit error and allows a recheck", async () => {
    const sendSwapTx = vi.fn();
    hooks.useSwapTransaction.mockReturnValue({
      sendSwapTx,
      isSwapTxLoading: false,
      isSwapTxReceiptLoading: false,
    });
    hooks.useTradingLimits.mockReturnValue({
      data: [{}],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchMocks.limits,
    });
    tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(
      "Cannot buy more than 2,000 USDm within 5min.",
    );
    hooks.useChainId.mockReturnValue(CELO);
    const { getByRole, getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Recheck trading limits");
    expect(getByRole("alert").textContent).toBe(
      "Cannot buy more than 2,000 USDm within 5min.",
    );
    fireEvent.click(button);
    await waitFor(() => expect(sendSwapTx).not.toHaveBeenCalled());
    expect(tradingLimitMocks.checkTradingLimitViolation).toHaveBeenCalledWith({
      limits: [{}],
      routeAmounts: ["1", "1"],
    });
  });

  it("blocks submission while refreshed trading limits are loading", () => {
    hooks.useTradingLimits.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: true,
      isLoading: true,
      refetch: refetchMocks.limits,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Checking trading limits...");
  });

  it("blocks submission while cached trading limits are refreshing", () => {
    hooks.useTradingLimits.mockReturnValue({
      data: [{}],
      isError: false,
      isFetching: true,
      isLoading: false,
      refetch: refetchMocks.limits,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Checking trading limits...");
    expect(tradingLimitMocks.checkTradingLimitViolation).not.toHaveBeenCalled();
  });

  it("shows a query error and allows a recheck", () => {
    hooks.useTradingLimits.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isLoading: false,
      refetch: refetchMocks.limits,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByRole, getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Recheck trading limits");
    expect(getByRole("alert").textContent).toBe(
      "Unable to verify trading limits. Please try again.",
    );
  });

  it("blocks submission while the confirmation quote is refreshing", () => {
    hooks.useOptimizedSwapQuote.mockReturnValue({
      amountWei: "100",
      quote: "1",
      rate: "1",
      isFetching: true,
      isError: false,
      hasInsufficientLiquidityError: false,
      quoteErrorMessage: null,
      routeAmounts: ["1", "1"],
      refetch: refetchMocks.quote,
      fromTokenUSDValue: "1",
      toTokenUSDValue: "1",
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    const button = getByTestId("swapButton") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Refreshing quote...");
  });

  it("retries after the first fresh limit read fails", async () => {
    const sendSwapTx = vi.fn();
    hooks.useSwapTransaction.mockReturnValue({
      sendSwapTx,
      isSwapTxLoading: false,
      isSwapTxReceiptLoading: false,
    });
    refetchMocks.limits
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce({ data: [], error: null, isError: false });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByRole, getByTestId } = renderConfirm(CELO);

    fireEvent.click(getByTestId("swapButton"));

    await waitFor(() => expect(sendSwapTx).not.toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId("swapButton").textContent).toBe(
        "Recheck trading limits",
      ),
    );
    expect(getByRole("alert").textContent).toBe(
      "Unable to verify trading limits. Please try again.",
    );

    fireEvent.click(getByTestId("swapButton"));

    await waitFor(() => expect(sendSwapTx).toHaveBeenCalledTimes(1));
    expect(refetchMocks.quote).toHaveBeenCalledTimes(2);
    expect(refetchMocks.limits).toHaveBeenCalledTimes(2);
  });

  it("blocks an enabled submission when fresh limits reject the quote", async () => {
    const sendSwapTx = vi.fn();
    hooks.useSwapTransaction.mockReturnValue({
      sendSwapTx,
      isSwapTxLoading: false,
      isSwapTxReceiptLoading: false,
    });
    hooks.useTradingLimits.mockReturnValue({
      data: [{}],
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchMocks.limits,
    });
    refetchMocks.limits.mockResolvedValue({
      data: [{}],
      error: null,
      isError: false,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByRole, getByTestId } = renderConfirm(CELO);
    tradingLimitMocks.checkTradingLimitViolation.mockReturnValue(
      "Fresh trading limit violation",
    );

    fireEvent.click(getByTestId("swapButton"));

    await waitFor(() => expect(sendSwapTx).not.toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId("swapButton").textContent).toBe(
        "Recheck trading limits",
      ),
    );
    expect(getByRole("alert").textContent).toBe(
      "Fresh trading limit violation",
    );
  });

  it("submits after fresh quote and limit verification succeeds", async () => {
    const sendSwapTx = vi.fn().mockResolvedValue(undefined);
    hooks.useSwapTransaction.mockReturnValue({
      sendSwapTx,
      isSwapTxLoading: false,
      isSwapTxReceiptLoading: false,
    });
    hooks.useChainId.mockReturnValue(CELO);
    const { getByTestId } = renderConfirm(CELO);

    fireEvent.click(getByTestId("swapButton"));

    await waitFor(() => expect(refetchMocks.quote).toHaveBeenCalledTimes(1));
    expect(refetchMocks.limits).toHaveBeenCalledTimes(1);
    expect(sendSwapTx).toHaveBeenCalledTimes(1);
  });
});
