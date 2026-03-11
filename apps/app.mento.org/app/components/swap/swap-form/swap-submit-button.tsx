"use client";

import { IconLoading } from "@repo/ui";
import { Button } from "@repo/ui";
import { ConnectButton, SWAP_INSUFFICIENT_LIQUIDITY_LABEL } from "@repo/web3";

import type { TokenWithBalance } from "@repo/web3";

interface SwapSubmitButtonProps {
  isConnected: boolean;
  hasAmount: boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  errors: { amount?: { message?: string } };
  isButtonLoading: boolean;
  isApproveTxLoading: boolean;
  isApprovalProcessing: boolean;
  tradingLimitError: string | null;
  balanceError: string | null;
  isTradingSuspended: boolean;
  isSuspensionCheckLoading: boolean;
  isError: boolean;
  hasInsufficientLiquidityError: boolean;
  quoteErrorMessage: string | null;
  hasValidQuote: boolean;
  shouldApprove: string | boolean;
  allTokenOptions: TokenWithBalance[];
}

export function SwapSubmitButton({
  isConnected,
  hasAmount,
  tokenInSymbol,
  tokenOutSymbol,
  errors,
  isButtonLoading,
  isApproveTxLoading,
  isApprovalProcessing,
  tradingLimitError,
  balanceError,
  isTradingSuspended,
  isSuspensionCheckLoading,
  isError,
  hasInsufficientLiquidityError,
  quoteErrorMessage,
  hasValidQuote,
  shouldApprove,
  allTokenOptions,
}: SwapSubmitButtonProps) {
  if (!isConnected) {
    return (
      <ConnectButton
        size="lg"
        text="Connect"
        fullWidth
        shouldShowAddress={false}
      />
    );
  }

  return (
    <Button
      data-testid={defineButtonLocator({
        balanceError,
        tradingLimitError,
        isTradingSuspended,
        shouldApprove,
        tokenInSymbol,
        tokenOutSymbol,
      })}
      className="mt-auto w-full"
      size="lg"
      clipped="lg"
      type="submit"
      disabled={
        !hasAmount ||
        !tokenOutSymbol ||
        !tokenInSymbol ||
        !hasValidQuote ||
        !!(errors.amount && errors.amount.message !== "Amount is required") ||
        isButtonLoading ||
        isApproveTxLoading ||
        isApprovalProcessing ||
        !!tradingLimitError ||
        !!balanceError ||
        isTradingSuspended ||
        isSuspensionCheckLoading ||
        isError
      }
    >
      {isButtonLoading ? (
        <IconLoading />
      ) : !tokenInSymbol ? (
        "Select token to sell"
      ) : !tokenOutSymbol ? (
        "Select token to buy"
      ) : hasInsufficientLiquidityError ? (
        SWAP_INSUFFICIENT_LIQUIDITY_LABEL
      ) : isError ? (
        quoteErrorMessage?.includes("FX market") ? (
          "FX market is closed"
        ) : (
          (quoteErrorMessage ?? "Unable to fetch quote")
        )
      ) : isTradingSuspended ? (
        `Trading suspended for ${tokenInSymbol} -> ${tokenOutSymbol}`
      ) : tradingLimitError ? (
        "Swap exceeds trading limits"
      ) : balanceError ? (
        "Insufficient balance"
      ) : errors.amount?.message &&
        errors.amount?.message !== "Amount is required" ? (
        errors.amount?.message
      ) : isApproveTxLoading || isApprovalProcessing ? (
        <IconLoading />
      ) : shouldApprove ? (
        `Approve ${allTokenOptions.find((t) => t.symbol === tokenInSymbol)?.symbol || tokenInSymbol}`
      ) : (
        "Swap"
      )}
    </Button>
  );
}

function defineButtonLocator({
  balanceError,
  tradingLimitError,
  isTradingSuspended,
  shouldApprove,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  balanceError: string | null;
  tradingLimitError: string | null;
  isTradingSuspended: boolean;
  shouldApprove: string | boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}) {
  switch (true) {
    case Boolean(isTradingSuspended):
      return "tradingSuspendedButton";
    case Boolean(balanceError && !tradingLimitError):
      return "insufficientBalanceButton";
    case Boolean(tradingLimitError):
      return "swapsExceedsTradingLimitButton";
    case Boolean(shouldApprove && tokenInSymbol && tokenOutSymbol):
      return "approveButton";
    case !tokenInSymbol:
      return "selectTokenToSellButton";
    case !tokenOutSymbol:
      return "selectTokenToBuyButton";
    default:
      return "swapButton";
  }
}
