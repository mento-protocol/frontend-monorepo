import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useEffect, useMemo, useCallback } from "react";
import { toast } from "@repo/ui";
import { useChainId } from "wagmi";

import { SWAP_QUOTE_REFETCH_INTERVAL } from "@/config/consts";
import {
  type TokenId,
  TokenId as TokenIdEnum,
  Tokens,
  getTokenAddress,
} from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import type { SwapDirection } from "@/features/swap/types";
import {
  calcExchangeRate,
  invertExchangeRate,
  parseInputExchangeAmount,
} from "@/features/swap/utils";
import { buildSwapRoute } from "@/features/swap/build-swap-route";
import {
  getToastErrorMessage,
  shouldRetrySwapError,
} from "@/features/swap/error-handlers";
import { fromWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { logger } from "@/utils/logger";

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
  tokenInId: TokenId,
  tokenOutId: TokenId,
  options: UseSwapQuoteOptions = {},
) {
  const { skipDebugLogs = false, debounceMs = 350 } = options;
  const chainId = useChainId();
  const queryClient = useQueryClient();
  const debouncedAmount = useDebounce(amount, debounceMs);

  // Memoize token objects to prevent unnecessary re-renders
  const { fromToken, toToken } = useMemo(
    () => ({
      fromToken: Tokens[tokenInId],
      toToken: Tokens[tokenOutId],
    }),
    [tokenInId, tokenOutId],
  );

  // Memoize validation checks
  const validation = useMemo(() => {
    const isValidAmount =
      debouncedAmount != null &&
      debouncedAmount !== "" &&
      Number(debouncedAmount) > 0;
    const isValidTokenPair =
      tokenInId !== tokenOutId && !!fromToken && !!toToken;
    const isQueryEnabled = isValidAmount && isValidTokenPair;

    return { isValidAmount, isValidTokenPair, isQueryEnabled };
  }, [debouncedAmount, tokenInId, tokenOutId, fromToken, toToken]);

  // Memoize query key to improve cache efficiency
  const queryKey = useMemo(
    () => [
      "swap-quote",
      debouncedAmount,
      tokenInId,
      tokenOutId,
      direction,
      chainId,
    ],
    [debouncedAmount, tokenInId, tokenOutId, direction, chainId],
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
          ? `${debouncedAmount} ${tokenInId} to ${tokenOutId}`
          : `${tokenInId} to ${debouncedAmount} ${tokenOutId}`;

      // Check if this is a refetch by looking for existing data
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      console.log(
        `${isRefetch ? "🔄 Refetching" : "🆕 Fetching"} quote for: ${swapIntent}`,
      );
    }

    const fromTokenAddr = getTokenAddress(tokenInId, chainId);
    const toTokenAddr = getTokenAddress(tokenOutId, chainId);
    const isSwapIn = direction === "in";

    const amountWei = parseInputExchangeAmount(
      amount,
      isSwapIn ? tokenInId : tokenOutId,
    );

    const amountWeiBN = ethers.BigNumber.from(amountWei);
    const amountDecimals = isSwapIn ? fromToken?.decimals : toToken?.decimals;
    const quoteDecimals = isSwapIn ? toToken?.decimals : fromToken?.decimals;

    if (amountWeiBN.lte(0)) return null;

    const [mento, tradablePair] = await Promise.all([
      getMentoSdk(chainId),
      getTradablePairForTokens(chainId, tokenInId, tokenOutId),
    ]);

    // Debug output for swap route (skip for refetches)
    if (!skipDebugLogs) {
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      if (!isRefetch) {
        const route = buildSwapRoute(tradablePair, fromTokenAddr, toTokenAddr);
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
          ? `${debouncedAmount} ${tokenInId} => ${quote} ${tokenOutId}`
          : `${quote} ${tokenInId} => ${debouncedAmount} ${tokenOutId}`;

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
    tokenInId,
    tokenOutId,
    chainId,
    direction,
    amount,
    debouncedAmount,
    queryClient,
    queryKey,
    fromToken,
    toToken,
  ]);

  const { isLoading, isError, error, data, refetch } = useQuery<
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
    return getToastErrorMessage(error.message, {
      fromTokenSymbol: fromToken?.symbol,
      toTokenSymbol: toToken?.symbol,
    });
  }, [error, fromToken?.symbol, toToken?.symbol]);

  useEffect(() => {
    if (errorMessage) {
      toast.error(errorMessage);
      logger.error(error);
    }
  }, [errorMessage, error]);

  return useMemo(
    () => ({
      isLoading,
      isError,
      amountWei: data?.amountWei || "0",
      quoteWei: data?.quoteWei || "0",
      quote: data?.quote || "0",
      rate: data?.rate,
      refetch,
    }),
    [isLoading, isError, data, refetch],
  );
}

/**
 * Hook to calculate USD value for a token amount
 * Fixed to comply with React's Rules of Hooks
 */
export function useTokenUSDValue(tokenId: TokenId, amount: string | number) {
  const isStablecoin = useMemo(() => tokenId === "cUSD", [tokenId]);
  const hasValidAmount = useMemo(
    () => amount && amount !== "" && Number(amount) > 0,
    [amount],
  );

  // Always call useSwapQuote, but disable it when not needed
  const { quote } = useSwapQuote(
    hasValidAmount ? amount : "",
    "in",
    tokenId,
    TokenIdEnum.cUSD,
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
  tokenInId: TokenId,
  tokenOutId: TokenId,
) {
  const mainQuote = useSwapQuote(amount, direction, tokenInId, tokenOutId);

  // Calculate USD values more efficiently
  const { fromAmount, toAmount } = useMemo(
    () => ({
      fromAmount: direction === "in" ? amount : mainQuote.quote,
      toAmount: direction === "in" ? mainQuote.quote : amount,
    }),
    [direction, amount, mainQuote.quote],
  );

  const fromTokenUSDValue = useTokenUSDValue(tokenInId, fromAmount);
  const toTokenUSDValue = useTokenUSDValue(tokenOutId, toAmount);

  return useMemo(
    () => ({
      ...mainQuote,
      fromTokenUSDValue,
      toTokenUSDValue,
    }),
    [mainQuote, fromTokenUSDValue, toTokenUSDValue],
  );
}
