import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenWithBalance } from "@repo/web3";

vi.mock("@mento-protocol/ui", () => ({
  IconLoading: () => <span>Loading</span>,
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@repo/web3", () => ({
  SWAP_INSUFFICIENT_LIQUIDITY_LABEL: "Insufficient liquidity",
  ConnectButton: () => <button type="button">Connect</button>,
}));

import { SwapSubmitButton } from "./swap-submit-button";

const allTokenOptions: TokenWithBalance[] = [];

const baseProps = {
  isConnected: true,
  hasAmount: true,
  tokenInSymbol: "USDm",
  tokenOutSymbol: "CELO",
  errors: {},
  isButtonLoading: false,
  isApproveTxLoading: false,
  isApprovalProcessing: false,
  tradingLimitError: null,
  balanceError: null,
  isTradingSuspended: false,
  isSuspensionCheckLoading: false,
  isError: false,
  hasInsufficientLiquidityError: false,
  quoteErrorMessage: null,
  hasValidQuote: true,
  shouldApprove: false,
  allTokenOptions,
};

describe("SwapSubmitButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables submit when there is no amount", () => {
    render(<SwapSubmitButton {...baseProps} hasAmount={false} />);

    expect(
      (screen.getByTestId("swapButton") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows the insufficient-balance state and disables submit", () => {
    render(
      <SwapSubmitButton {...baseProps} balanceError="Insufficient balance" />,
    );

    const button = screen.getByTestId(
      "insufficientBalanceButton",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Insufficient balance");
  });

  it("shows the exceeds-trading-limit state and disables submit", () => {
    render(
      <SwapSubmitButton
        {...baseProps}
        tradingLimitError="Swap exceeds trading limits"
      />,
    );

    const button = screen.getByTestId(
      "swapsExceedsTradingLimitButton",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Swap exceeds trading limits");
  });

  it("prefers the trading-limit testid when both errors are present", () => {
    render(
      <SwapSubmitButton
        {...baseProps}
        balanceError="Insufficient balance"
        tradingLimitError="Swap exceeds trading limits"
      />,
    );

    expect(
      (
        screen.getByTestId(
          "swapsExceedsTradingLimitButton",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("enables submit for a valid amount with no errors", () => {
    render(<SwapSubmitButton {...baseProps} />);

    expect(
      (screen.getByTestId("swapButton") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
