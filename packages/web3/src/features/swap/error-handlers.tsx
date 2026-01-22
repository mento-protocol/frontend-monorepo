import { JSX } from "react";
import { getContractAddress } from "@mento-protocol/mento-sdk";
import { getExplorerUrl } from "@/utils/chain";

interface SwapErrorOptions {
  fromTokenSymbol?: string;
  toTokenSymbol?: string;
  chainId?: number;
  type?: "quote" | "swap";
  insufficientLiquidityFallbackUrl?: string;
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
  NO_ROUTE_FOUND: "No route found for tokens",
  NO_TRADABLE_PATH: "They may not have a tradable path",
  NO_VALID_MEDIAN: "no valid median",
  // Router/oracle failures sometimes surface as an undecoded custom error selector
  // instead of the underlying "no valid median" revert string.
  NO_VALID_MEDIAN_SELECTOR: "0xeb0d3e81",
  INSUFFICIENT_RESERVE_BALANCE: "Insufficient balance in reserve",
  INSUFFICIENT_LIQUIDITY: "0xbb55fd27",
  INSUFFICIENT_LIQUIDITY_NAME: "InsufficientLiquidity",
  INSUFFICIENT_LIQUIDITY_TEXT: "Insufficient liquidity",
  FX_MARKET_CLOSED: "FX market is currently closed",
  FX_MARKET_CLOSED_SELECTOR: "0xa407143a",
} as const;

export const USER_ERROR_MESSAGES = {
  TRADING_PAUSED: "Trading temporarily paused.  Please try again later.",
  SWAP_REJECTED_BY_USER: "Swap transaction rejected by user.",
  INSUFFICIENT_FUNDS: "Insufficient funds for transaction.",
  TRANSACTION_FAILED: "Transaction failed on blockchain.",
  UNKNOWN_ERROR: "Unable to complete swap transaction",
} as const;

export const SWAP_INSUFFICIENT_LIQUIDITY_LABEL =
  SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY_TEXT;
export const SWAP_INSUFFICIENT_LIQUIDITY_MESSAGE =
  "Liquidity for some Mento V3 pools is still being bootstrapped. Try a smaller amount, or use the V2 app for deeper liquidity.";
export const SWAP_INSUFFICIENT_LIQUIDITY_LINK_LABEL = "Open V2 app";

interface InsufficientLiquidityContentOptions {
  insufficientLiquidityFallbackUrl?: string;
}

export function getInsufficientLiquidityNoticeContent({
  insufficientLiquidityFallbackUrl,
}: InsufficientLiquidityContentOptions = {}): string | JSX.Element {
  if (!insufficientLiquidityFallbackUrl) {
    return SWAP_INSUFFICIENT_LIQUIDITY_MESSAGE;
  }

  return (
    <>
      {SWAP_INSUFFICIENT_LIQUIDITY_MESSAGE}{" "}
      <a
        href={insufficientLiquidityFallbackUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        {SWAP_INSUFFICIENT_LIQUIDITY_LINK_LABEL}
      </a>
    </>
  );
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
    insufficientLiquidityFallbackUrl,
  }: Omit<SwapErrorOptions, "type"> = {},
): string | JSX.Element {
  const checkedErrorMessage = extractFullErrorString(swapErrorMessage);

  const errorChecks = [
    {
      condition: checkedErrorMessage.includes(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1),
      message: "Amount in is too large",
    },
    {
      condition: checkedErrorMessage.includes(
        SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE,
      ),
      message: "Amount out is too large",
    },
    {
      condition:
        isReferenceRateUnavailableError(checkedErrorMessage) ||
        checkedErrorMessage.includes(SWAP_ERROR_MESSAGES.NO_VALID_MEDIAN) ||
        checkedErrorMessage.includes(
          SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE,
        ),
      message:
        fromTokenSymbol && toTokenSymbol
          ? `Trading temporarily paused. Unable to determine accurate ${fromTokenSymbol} to ${toTokenSymbol} exchange rate now. Please try again later.`
          : USER_ERROR_MESSAGES.TRADING_PAUSED,
    },
    {
      condition:
        checkedErrorMessage.includes(SWAP_ERROR_MESSAGES.NO_ROUTE_FOUND) ||
        checkedErrorMessage.includes(SWAP_ERROR_MESSAGES.NO_TRADABLE_PATH),
      message:
        fromTokenSymbol && toTokenSymbol
          ? `No route found for ${fromTokenSymbol} to ${toTokenSymbol}. Please select a different token pair.`
          : "No route found for the selected token pair.",
    },
    {
      condition: checkedErrorMessage.includes(
        SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE,
      ),
      message:
        toTokenSymbol && chainId
          ? (() => {
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
            })()
          : "The Reserve does not have enough tokens to execute this swap. Please try a smaller amount or try again later.",
    },
    {
      condition:
        checkedErrorMessage.includes(
          SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY,
        ) ||
        checkedErrorMessage.includes(
          SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY_TEXT,
        ) ||
        checkedErrorMessage.includes(
          SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY_NAME,
        ),
      message: getInsufficientLiquidityNoticeContent({
        insufficientLiquidityFallbackUrl,
      }),
    },
    {
      condition: isFxMarketClosedError(checkedErrorMessage),
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

  const serializeCauseData = (data: unknown): string => {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (typeof data !== "object") return String(data);
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.args)) return (obj.args as unknown[]).join(", ");
    try {
      return JSON.stringify(data);
    } catch {
      return "";
    }
  };

  return [
    (err.message as string) ?? "",
    (err.reason as string) ?? "",
    (err.shortMessage as string) ?? "",
    (cause?.message as string) ?? "",
    serializeCauseData(cause?.data),
    (cause?.signature as string) ?? "",
    (err.name as string) ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function isInsufficientLiquidityError(error: unknown): boolean {
  const errorMessage = extractFullErrorString(error).toLowerCase();
  return (
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY.toLowerCase(),
    ) ||
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY_NAME.toLowerCase(),
    ) ||
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.INSUFFICIENT_LIQUIDITY_TEXT.toLowerCase(),
    )
  );
}

export function isNoValidMedianError(error: unknown): boolean {
  const errorMessage = extractFullErrorString(error).toLowerCase();
  return (
    errorMessage.includes(SWAP_ERROR_MESSAGES.NO_VALID_MEDIAN.toLowerCase()) ||
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.NO_VALID_MEDIAN_SELECTOR.toLowerCase(),
    )
  );
}

export function isReferenceRateUnavailableError(error: unknown): boolean {
  const errorMessage = extractFullErrorString(error).toLowerCase();
  return (
    isNoValidMedianError(errorMessage) ||
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE.toLowerCase(),
    )
  );
}

export function isFxMarketClosedError(error: unknown): boolean {
  const errorMessage = extractFullErrorString(error).toLowerCase();
  return (
    errorMessage.includes(SWAP_ERROR_MESSAGES.FX_MARKET_CLOSED.toLowerCase()) ||
    errorMessage.includes("fxmarketclosed") ||
    errorMessage.includes(
      SWAP_ERROR_MESSAGES.FX_MARKET_CLOSED_SELECTOR.toLowerCase(),
    )
  );
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
  if (isReferenceRateUnavailableError(errorMessage)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.OVERFLOW_X1Y1)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.FIXIDITY_TOO_LARGE))
    return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.NO_ROUTE_FOUND)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.NO_TRADABLE_PATH)) return false;
  if (errorMessage.includes(SWAP_ERROR_MESSAGES.INSUFFICIENT_RESERVE_BALANCE))
    return false;
  if (isInsufficientLiquidityError(errorMessage)) return false;
  if (isFxMarketClosedError(errorMessage)) return false;

  return failureCount < 2;
}
