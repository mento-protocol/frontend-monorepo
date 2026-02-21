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
  INSUFFICIENT_LIQUIDITY: "0xbb55fd27",
  FX_MARKET_CLOSED: "FX market is currently closed",
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
    {
      condition: swapErrorMessage.includes(
        SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY,
      ),
      message: "Insufficient liquidity for this swap. Try a smaller amount.",
    },
    {
      condition:
        swapErrorMessage.includes(SWAP_ERROR_MESSAGES.FX_MARKET_CLOSED) ||
        swapErrorMessage.includes("FXMarketClosed"),
      message:
        "FX market is currently closed. Trading will resume when the market reopens.",
    },
  ];

  const matchedError = errorChecks.find((check) => check.condition);
  return matchedError?.message || "Unable to fetch swap amount";
}

/**
 * Extracts a comprehensive error string that includes nested cause/data/signature
 * fields from viem errors, ensuring custom error selectors are not lost.
 */
export function extractFullErrorString(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;

  const err = error as Record<string, unknown>;
  const cause = err.cause as Record<string, unknown> | undefined;

  return [
    (err.message as string) ?? "",
    (err.reason as string) ?? "",
    (err.shortMessage as string) ?? "",
    (cause?.message as string) ?? "",
    (cause?.data as string) ?? "",
    (cause?.signature as string) ?? "",
    (err.name as string) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Determines if an error should be retried in React Query
 */
export function shouldRetrySwapError(
  failureCount: number,
  error: unknown,
): boolean {
  const errorMessage = extractFullErrorString(error);
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.TRADING_SUSPENDED))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY))
    return false;
  if (
    errorMessage.includes(SWAP_ERROR_MESSAGES.FX_MARKET_CLOSED) ||
    errorMessage.includes("FXMarketClosed")
  )
    return false;

  return failureCount < 2;
}
