import { JSX } from "react";
import { getContractAddress } from "@mento-protocol/mento-sdk";
import { getExplorerUrl } from "@/utils/chain";

interface SwapErrorOptions {
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  chainId?: number;
  type?: "quote" | "swap";
}

/**
 * Error message strings used for swap error detection
 */
export const SWAP_ERROR_MESSAGES = {
  OVERFLOW_X1Y1: "overflow x1y1",
  FIXIDITY_TOO_LARGE: "can't create fixidity number larger than",
  TRADING_SUSPENDED: "Trading is suspended",
  TRADING_SUSPENDED_REFERENCE_RATE:
    "Trading is suspended for this reference rate",
  NO_VALID_MEDIAN: "no valid median",
  INSUFFICIENT_RESERVE_BALANCE: "Insufficient balance in reserve",
} as const;

/**
 * Converts swap error messages to user-friendly toast messages
 */
export function getToastErrorMessage(
  swapErrorMessage: string,
  {
    fromTokenSymbol,
    toTokenSymbol,
    chainId,
  }: Omit<SwapErrorOptions, "type"> = {},
): string | (() => JSX.Element) {
  const errorChecks = [
    {
      condition: swapErrorMessage.includes(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1),
      message: "Amount in is too large",
    },
    {
      condition: swapErrorMessage.includes(
        SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE,
      ),
      message: "Amount out is too large",
    },
    {
      condition:
        swapErrorMessage.includes(SWAP_ERROR_MESSAGES.NO_VALID_MEDIAN) ||
        swapErrorMessage.includes(
          SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE,
        ),
      message: `Trading temporarily paused. Unable to determine accurate ${fromTokenSymbol} to ${toTokenSymbol} exchange rate now. Please try again later.`,
    },
    {
      condition: swapErrorMessage.includes(
        SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE,
      ),
      message:
        toTokenSymbol && chainId
          ? () => {
              const reserveAddress = getContractAddress(chainId, "Reserve");
              const explorerUrl = getExplorerUrl(chainId);
              const reserveUrl = reserveAddress
                ? `${explorerUrl}/address/${reserveAddress}`
                : explorerUrl;

              return (
                <>
                  The{" "}
                  <a
                    href={reserveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    Reserve
                  </a>{" "}
                  does not have enough {toTokenSymbol} to execute this swap.
                  Please try a smaller amount or try again later.
                </>
              );
            }
          : "The Reserve does not have enough tokens to execute this swap. Please try a smaller amount or try again later.",
    },
  ];

  const matchedError = errorChecks.find((check) => check.condition);
  return matchedError?.message || "Unable to fetch swap amount";
}

/**
 * Determines if an error should be retried in React Query
 */
export function shouldRetrySwapError(
  failureCount: number,
  error: unknown,
): boolean {
  // Don't retry on certain errors
  // Extract error message, checking both message and reason properties
  // (ethers errors sometimes have the revert reason in error.reason)
  const errorMessage =
    error instanceof Error
      ? error.message || (error as { reason?: string }).reason || String(error)
      : String(error);
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.TRADING_SUSPENDED))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE))
    return false;

  return failureCount < 2;
}
