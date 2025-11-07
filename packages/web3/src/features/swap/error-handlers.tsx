import { JSX } from "react";
import { addresses } from "@mento-protocol/mento-sdk";
import { getExplorerUrl } from "@/utils/chain";

interface SwapErrorOptions {
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  chainId?: number;
  type?: "quote" | "swap";
}

/**
 * Gets the Reserve contract address for a given chainId
 */
function getReserveAddress(chainId: number): string | undefined {
  const chainAddresses = addresses[chainId];
  return chainAddresses?.Reserve;
}

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
      condition: swapErrorMessage.includes("overflow x1y1"),
      message: "Amount in is too large",
    },
    {
      condition: swapErrorMessage.includes(
        "can't create fixidity number larger than",
      ),
      message: "Amount out is too large",
    },
    {
      condition:
        swapErrorMessage.includes("no valid median") ||
        swapErrorMessage.includes(
          "Trading is suspended for this reference rate",
        ),
      message: `Trading temporarily paused. Unable to determine accurate ${fromTokenSymbol} to ${toTokenSymbol} exchange rate now. Please try again later.`,
    },
    {
      condition: swapErrorMessage.includes("Insufficient balance in reserve"),
      message:
        toTokenSymbol && chainId
          ? () => {
              const reserveAddress = getReserveAddress(chainId);
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
  if (errorMessage.includes("Trading is suspended")) return false;
  if (errorMessage.includes("overflow x1y1")) return false;
  if (errorMessage.includes("can't create fixidity number larger than"))
    return false;
  if (errorMessage.includes("Insufficient balance in reserve")) return false;

  return failureCount < 2;
}
