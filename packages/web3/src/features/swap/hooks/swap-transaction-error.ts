import type { JSX } from "react";
import {
  extractFullErrorString,
  getInsufficientLiquidityNoticeContent,
  getToastErrorMessage,
  isFxMarketClosedError,
  isInsufficientLiquidityError,
  isReferenceRateUnavailableError,
  USER_ERROR_MESSAGES,
} from "@/features/swap/error-handlers";
import { isUserRejection } from "@/utils/is-user-rejection";
import { logger } from "@/utils/logger";

export function getSwapTransactionErrorMessage(
  error: Error | string,
  {
    fromTokenSymbol,
    toTokenSymbol,
    chainId,
  }: {
    fromTokenSymbol?: string;
    toTokenSymbol?: string;
    chainId?: number;
  } = {},
  insufficientLiquidityFallbackUrl?: string,
): string | JSX.Element {
  const errorMessage = extractFullErrorString(error);

  if (isInsufficientLiquidityError(errorMessage)) {
    return getInsufficientLiquidityNoticeContent({
      insufficientLiquidityFallbackUrl,
    });
  }

  const sharedMessage = getToastErrorMessage(errorMessage, {
    fromTokenSymbol,
    toTokenSymbol,
    chainId,
    insufficientLiquidityFallbackUrl,
  });

  if (sharedMessage !== "Unable to fetch swap amount") {
    return sharedMessage;
  }

  switch (true) {
    case isUserRejection(errorMessage):
      return USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER;
    case errorMessage.includes("No route found for tokens") ||
      errorMessage.includes("tradable path"):
      return "No route found for the selected token pair.";
    case errorMessage.includes("Slippage tolerance"):
      return "Slippage exceeds the maximum supported value.";
    case errorMessage.includes("insufficient funds"):
      return USER_ERROR_MESSAGES.INSUFFICIENT_FUNDS;
    case errorMessage.includes("Transaction failed"):
      return USER_ERROR_MESSAGES.TRANSACTION_FAILED;
    case isReferenceRateUnavailableError(errorMessage):
      return USER_ERROR_MESSAGES.TRADING_PAUSED;
    case isFxMarketClosedError(errorMessage):
      return "FX market is currently closed. Please try again when the market reopens.";
    default:
      logger.warn(`Unhandled swap error for toast: ${errorMessage}`);
      return USER_ERROR_MESSAGES.UNKNOWN_ERROR;
  }
}
