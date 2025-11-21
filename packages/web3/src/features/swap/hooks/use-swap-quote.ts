import { toast } from "@repo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo } from "react";
import { useChainId } from "wagmi";

import { SWAP_QUOTE_REFETCH_INTERVAL } from "@/config/constants";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { buildSwapRoute } from "@/features/swap/build-swap-route";
import {
  getToastErrorMessage,
  shouldRetrySwapError,
} from "@/features/swap/error-handlers";
import type { SwapDirection } from "@/features/swap/types";
import {
  calcExchangeRate,
  invertExchangeRate,
  isValidTokenPair,
  parseInputExchangeAmount,
} from "@/features/swap/utils";
import { fromWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { logger } from "@/utils/logger";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";

interface ISwapError {
  message: string;
}

interface ISwapData {
  amountWei: string;
  quoteWei: string;
  quote: string;
  rate: string;
}

interface UseSwapQuoteOptions {
  skipDebugLogs?: boolean;
  debounceMs?: number;
}

/**
 * Core hook for fetching swap quotes between two tokens
 */
export function useSwapQuote(
  amount: string | number,
  direction: SwapDirection,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
  options: UseSwapQuoteOptions = {},
) {
  const { skipDebugLogs = false, debounceMs = 350 } = options;
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const debouncedAmount = useDebounce(amount, debounceMs);

  // Memoize token objects to prevent unnecessary re-renders
  const { fromToken, toToken } = useMemo(
    () => ({
      fromToken: getTokenBySymbol(tokenInSymbol, chainId),
      toToken: getTokenBySymbol(tokenOutSymbol, chainId),
    }),
    [tokenInSymbol, tokenOutSymbol, chainId],
  );

  // Memoize validation checks
  const validation = useMemo(() => {
    const isValidAmount =
      debouncedAmount != null &&
      debouncedAmount !== "" &&
      Number(debouncedAmount) > 0;
    const isValidPair = isValidTokenPair(
      tokenInSymbol,
      tokenOutSymbol,
      fromToken,
      toToken,
    );
    const isQueryEnabled = isValidAmount && isValidPair;

    return { isValidAmount, isValidTokenPair: isValidPair, isQueryEnabled };
  }, [debouncedAmount, tokenInSymbol, tokenOutSymbol, fromToken, toToken]);

  // Memoize query key to improve cache efficiency
  const queryKey = useMemo(
    () => [
      "swap-quote",
      debouncedAmount,
      tokenInSymbol,
      tokenOutSymbol,
      direction,
      chainId,
    ],
    [debouncedAmount, tokenInSymbol, tokenOutSymbol, direction, chainId],
  );

  // Memoize swap intent for logging
  // Memoize the quote fetcher function
  const fetchQuote = useCallback(async (): Promise<ISwapData | null> => {
    if (!validation.isQueryEnabled) return null;

    // Guard clause: ensure tokens exist before proceeding
    if (!fromToken || !toToken) return null;

    if (!skipDebugLogs) {
      const swapIntent =
        direction === "in"
          ? `${debouncedAmount} ${tokenInSymbol} to ${tokenOutSymbol}`
          : `${tokenInSymbol} to ${debouncedAmount} ${tokenOutSymbol}`;

      // Check if this is a refetch by looking for existing data
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      console.log(
        `${isRefetch ? "🔄 Refetching" : "🆕 Fetching"} quote for: ${swapIntent}`,
      );
    }

    const fromTokenAddr = getTokenAddress(tokenInSymbol, chainId);
    const toTokenAddr = getTokenAddress(tokenOutSymbol, chainId);
    if (!fromTokenAddr) {
      throw new Error(
        `${tokenInSymbol} token address not found on chain ${chainId}`,
      );
    }
    if (!toTokenAddr) {
      throw new Error(
        `${tokenOutSymbol} token address not found on chain ${chainId}`,
      );
    }
    const isSwapIn = direction === "in";

    const amountWei = parseInputExchangeAmount(
      amount,
      isSwapIn ? tokenInSymbol : tokenOutSymbol,
      chainId,
    );

    const amountWeiBN = ethers.BigNumber.from(amountWei);
    const amountDecimals = isSwapIn ? fromToken?.decimals : toToken?.decimals;
    const quoteDecimals = isSwapIn ? toToken?.decimals : fromToken?.decimals;

    if (amountWeiBN.lte(0)) return null;

    const [mento, tradablePair] = await Promise.all([
      getMentoSdk(chainId),
      getTradablePairForTokens(chainId, tokenInSymbol, tokenOutSymbol),
    ]);

    // Debug output for swap route (skip for refetches)
    if (!skipDebugLogs) {
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      if (!isRefetch) {
        const route = buildSwapRoute(
          tradablePair,
          fromTokenAddr,
          toTokenAddr,
          chainId,
        );
        console.log(`Swap route: ${route}`);
      }
    }

    const quoteWei = (
      isSwapIn
        ? await mento.getAmountOut(
            fromTokenAddr,
            toTokenAddr,
            amountWeiBN,
            tradablePair,
          )
        : await mento.getAmountIn(
            fromTokenAddr,
            toTokenAddr,
            amountWeiBN,
            tradablePair,
          )
    ).toString();

    const quote = fromWei(quoteWei, quoteDecimals);
    const rateIn = calcExchangeRate(
      amountWei,
      amountDecimals,
      quoteWei,
      quoteDecimals,
    );
    const rate = isSwapIn ? rateIn : invertExchangeRate(rateIn);

    if (!skipDebugLogs) {
      const quoteLog =
        direction === "in"
          ? `${debouncedAmount} ${tokenInSymbol} => ${quote} ${tokenOutSymbol}`
          : `${quote} ${tokenInSymbol} => ${debouncedAmount} ${tokenOutSymbol}`;

      // Check if this is a refetch for the result log too
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      console.log(
        `✅ ${isRefetch ? "Refetched" : "Fetched"} quote for: ${quoteLog}`,
      );
    }

    return {
      amountWei,
      quoteWei,
      quote,
      rate,
    };
  }, [
    validation.isQueryEnabled,
    skipDebugLogs,
    tokenInSymbol,
    tokenOutSymbol,
    chainId,
    direction,
    amount,
    debouncedAmount,
    queryClient,
    queryKey,
    fromToken,
    toToken,
  ]);

  const { isFetching, isError, error, data, refetch } = useQuery<
    ISwapData | null,
    ISwapError
  >({
    queryKey,
    queryFn: fetchQuote,
    enabled: validation.isQueryEnabled,
    staleTime: SWAP_QUOTE_REFETCH_INTERVAL,
    refetchInterval: SWAP_QUOTE_REFETCH_INTERVAL,
    retry: shouldRetrySwapError,
  });

  // Memoize error handling to prevent unnecessary effect runs
  const errorMessage = useMemo(() => {
    if (!error) return null;
    // Extract error message, checking both message and reason properties
    // (ethers errors sometimes have the revert reason in error.reason)
    const errorMsg =
      error.message || (error as { reason?: string }).reason || String(error);
    return getToastErrorMessage(errorMsg, {
      fromTokenSymbol: fromToken?.symbol,
      toTokenSymbol: toToken?.symbol,
      chainId,
    });
  }, [error, fromToken?.symbol, toToken?.symbol, chainId]);

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
      logger.error(error);
    }
  }, [errorMessage, error]);

  return useMemo(
    () => ({
      isFetching,
      isError,
      amountWei: data?.amountWei || "0",
      quoteWei: data?.quoteWei || "0",
      quote: data?.quote || "0",
      rate: data?.rate,
      refetch,
    }),
    [isFetching, isError, data, refetch],
  );
}

/**
 * Hook to calculate USD value for a token amount
 */
export function useTokenUSDValue(
  tokenSymbol: TokenSymbol,
  amount: string | number,
) {
  const isStablecoin = useMemo(() => tokenSymbol === "cUSD", [tokenSymbol]);
  const hasValidAmount = useMemo(
    () => amount && amount !== "" && Number(amount) > 0,
    [amount],
  );

  // Always call useSwapQuote, but disable it when not needed
  const { quote } = useSwapQuote(
    hasValidAmount ? amount : "",
    "in",
    tokenSymbol,
    TokenSymbol.cUSD,
    {
      skipDebugLogs: true,
    },
  );

  return useMemo(() => {
    if (isStablecoin && hasValidAmount) {
      return amount.toString();
    }
    if (hasValidAmount && !isStablecoin) {
      return quote;
    }
    return "0";
  }, [isStablecoin, hasValidAmount, amount, quote]);
}

/**
 * Hook that optimizes swap quotes and USD value calculations
 * Reduces the number of useSwapQuote calls from 3 to 1 when possible
 */
export function useOptimizedSwapQuote(
  amount: string | number,
  direction: SwapDirection,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
) {
  const mainQuote = useSwapQuote(
    amount,
    direction,
    tokenInSymbol,
    tokenOutSymbol,
  );

  // Calculate USD values more efficiently
  const { fromAmount, toAmount } = useMemo(
    () => ({
      fromAmount: direction === "in" ? amount : mainQuote.quote,
      toAmount: direction === "in" ? mainQuote.quote : amount,
    }),
    [direction, amount, mainQuote.quote],
  );

  const fromTokenUSDValue = useTokenUSDValue(tokenInSymbol, fromAmount);
  const toTokenUSDValue = useTokenUSDValue(tokenOutSymbol, toAmount);

  return useMemo(
    () => ({
      ...mainQuote,
      fromTokenUSDValue,
      toTokenUSDValue,
    }),
    [mainQuote, fromTokenUSDValue, toTokenUSDValue],
  );
}
