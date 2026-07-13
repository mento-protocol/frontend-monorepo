/**
 * Tests that SwapConfirm quotes and executes on the ROUTE chain (its `chainId`
 * prop), not the wallet chain, and blocks execution on a wallet/route mismatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";

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
  useChainId: vi.fn(),
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
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    useAccountBalances: hooks.useAccountBalances,
    useTokenOptions: hooks.useTokenOptions,
    useOptimizedSwapQuote: hooks.useOptimizedSwapQuote,
    useSwapAllowance: hooks.useSwapAllowance,
    useSwapTransaction: hooks.useSwapTransaction,
    useGasEstimation: hooks.useGasEstimation,
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
    isError: false,
    hasInsufficientLiquidityError: false,
    quoteErrorMessage: null,
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
});
