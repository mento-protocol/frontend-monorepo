interface SwapErrorOptions {
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  type?: "quote" | "swap";
}

/**
 * Converts swap error messages to user-friendly toast messages
 */
export function getToastErrorMessage(
  swapErrorMessage: string,
  { fromTokenSymbol, toTokenSymbol }: Omit<SwapErrorOptions, "type"> = {},
): string {
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
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes("Trading is suspended")) return false;
  if (errorMessage.includes("overflow x1y1")) return false;
  if (errorMessage.includes("can't create fixidity number larger than"))
    return false;

  return failureCount < 2;
}
