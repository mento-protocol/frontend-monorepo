import { toast } from "@repo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type Address, type ReadContractReturnType } from "viem";
import { useChainId, usePublicClient } from "wagmi";

import { SWAP_QUOTE_REFETCH_INTERVAL } from "@/config/constants";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { buildSwapRoute } from "@/features/swap/build-swap-route";
import {
  extractFullErrorString,
  getToastErrorMessage,
  isInsufficientLiquidityError,
  SWAP_INSUFFICIENT_LIQUIDITY_LABEL,
  shouldRetrySwapError,
} from "@/features/swap/error-handlers";
import {
  calcExchangeRate,
  isValidTokenPair,
  parseInputExchangeAmount,
} from "@/features/swap/utils";
import { fromWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { logger } from "@/utils/logger";
import {
  ROUTER_ABI,
  TokenSymbol,
  type Route,
  encodeRoutePath,
  getContractAddress,
  getTokenAddress,
  type Mento,
} from "@mento-protocol/mento-sdk";

const TOAST_THROTTLE_MS = 10_000;

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
  validatePoolLiquidity?: boolean;
  insufficientLiquidityFallbackUrl?: string;
}

function isSameAddress(addressA: string, addressB: string): boolean {
  return addressA.toLowerCase() === addressB.toLowerCase();
}

async function validateRouteLiquidity(params: {
  mento: Mento;
  route: Route;
  amounts: ReadContractReturnType<typeof ROUTER_ABI, "getAmountsOut">;
  routerRoutes: ReturnType<typeof encodeRoutePath>;
}) {
  const { mento, route, amounts, routerRoutes } = params;

  if (route.path.length === 0) return;
  if (amounts.length !== route.path.length + 1) {
    throw new Error("Unable to validate swap liquidity.");
  }

  const poolDetails = await Promise.all(
    route.path.map((pool) => mento.pools.getPoolDetails(pool.poolAddr)),
  );

  for (const [hopIndex, pool] of route.path.entries()) {
    const hopTokenOut = routerRoutes[hopIndex]?.to;
    if (!hopTokenOut) {
      throw new Error("Unable to validate swap liquidity.");
    }

    const details = poolDetails[hopIndex];
    const hopAmountOut = amounts[hopIndex + 1];
    if (!details || hopAmountOut == null) {
      throw new Error("Unable to validate swap liquidity.");
    }

    const reserveOut = isSameAddress(hopTokenOut, pool.token0)
      ? details.reserve0
      : isSameAddress(hopTokenOut, pool.token1)
        ? details.reserve1
        : null;

    if (reserveOut == null) {
      throw new Error("Unable to validate swap liquidity.");
    }

    // Router swaps require output strictly below available reserve.
    if (hopAmountOut >= reserveOut) {
      throw new Error(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
    }
  }
}

/**
 * Core hook for fetching swap quotes between two tokens.
 * Only supports exact input swaps (selling exact amount of tokenIn to receive tokenOut).
 */
export function useSwapQuote(
  amount: string | number,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
  options: UseSwapQuoteOptions = {},
) {
  const {
    skipDebugLogs = false,
    debounceMs = 350,
    validatePoolLiquidity = true,
    insufficientLiquidityFallbackUrl,
  } = options;
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
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
    const isQueryEnabled = isValidAmount && isValidPair && !!publicClient;

    return { isValidAmount, isValidTokenPair: isValidPair, isQueryEnabled };
  }, [
    debouncedAmount,
    tokenInSymbol,
    tokenOutSymbol,
    fromToken,
    toToken,
    publicClient,
  ]);

  // Memoize query key to improve cache efficiency
  const queryKey = useMemo(
    () => [
      "swap-quote",
      debouncedAmount,
      tokenInSymbol,
      tokenOutSymbol,
      chainId,
      validatePoolLiquidity,
    ],
    [
      debouncedAmount,
      tokenInSymbol,
      tokenOutSymbol,
      chainId,
      validatePoolLiquidity,
    ],
  );

  // Memoize swap intent for logging
  // Memoize the quote fetcher function
  const fetchQuote = useCallback(async (): Promise<ISwapData | null> => {
    if (!validation.isQueryEnabled) return null;

    // Guard clause: ensure tokens exist before proceeding
    if (!fromToken || !toToken) return null;

    if (!skipDebugLogs) {
      const swapIntent = `${debouncedAmount} ${tokenInSymbol} to ${tokenOutSymbol}`;

      // Check if this is a refetch by looking for existing data
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      console.log(
        `${isRefetch ? "🔄 Refetching" : "🆕 Fetching"} quote for: ${swapIntent}`,
      );
    }

    const fromTokenAddr = getTokenAddress(chainId, tokenInSymbol);
    const toTokenAddr = getTokenAddress(chainId, tokenOutSymbol);
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

    const amountWei = parseInputExchangeAmount(amount, tokenInSymbol, chainId);

    const amountBigInt = BigInt(amountWei);
    const amountDecimals = fromToken?.decimals;
    const quoteDecimals = toToken?.decimals;

    if (amountBigInt <= 0n) return null;

    const [mento, route] = await Promise.all([
      getMentoSdk(chainId),
      getTradablePairForTokens(chainId, tokenInSymbol, tokenOutSymbol),
    ]);

    if (!publicClient) return null;

    const routerRoutes = encodeRoutePath(
      route.path,
      fromTokenAddr as Address,
      toTokenAddr as Address,
    );
    const routerAddress = getContractAddress(chainId, "Router");

    const amounts = await publicClient.readContract({
      address: routerAddress as Address,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountBigInt, routerRoutes],
    });

    if (validatePoolLiquidity) {
      await validateRouteLiquidity({
        mento,
        route,
        amounts,
        routerRoutes,
      });
    }

    // Debug output for swap route (skip for refetches)
    if (!skipDebugLogs) {
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      if (!isRefetch) {
        const routeStr = buildSwapRoute(
          route,
          fromTokenAddr,
          toTokenAddr,
          chainId,
        );
        console.log(`Swap route: ${routeStr}`);
      }
    }

    const quoteWei = amounts.at(-1);
    if (quoteWei == null) {
      throw new Error("Unable to fetch swap amount");
    }

    const quote = fromWei(quoteWei.toString(), quoteDecimals ?? 18);
    const rate = calcExchangeRate(
      amountWei,
      amountDecimals ?? 18,
      quoteWei.toString(),
      quoteDecimals ?? 18,
    );

    if (!skipDebugLogs) {
      const quoteLog = `${debouncedAmount} ${tokenInSymbol} => ${quote} ${tokenOutSymbol}`;

      // Check if this is a refetch for the result log too
      const existingData = queryClient.getQueryData(queryKey);
      const isRefetch = !!existingData;

      console.log(
        `✅ ${isRefetch ? "Refetched" : "Fetched"} quote for: ${quoteLog}`,
      );
    }

    return {
      amountWei: amountBigInt.toString(),
      quoteWei: quoteWei.toString(),
      quote,
      rate,
    };
  }, [
    validation.isQueryEnabled,
    skipDebugLogs,
    tokenInSymbol,
    tokenOutSymbol,
    chainId,
    amount,
    debouncedAmount,
    queryClient,
    queryKey,
    fromToken,
    toToken,
    publicClient,
    validatePoolLiquidity,
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

    const errorMsg = extractFullErrorString(error);

    // Skip toast for trading suspension - handled by useTradingSuspensionCheck
    if (errorMsg.includes("Trading is suspended")) {
      logger.error(error);
      return null;
    }

    return getToastErrorMessage(errorMsg, {
      fromTokenSymbol: fromToken?.symbol,
      toTokenSymbol: toToken?.symbol,
      chainId,
      insufficientLiquidityFallbackUrl,
    });
  }, [
    error,
    fromToken?.symbol,
    toToken?.symbol,
    chainId,
    insufficientLiquidityFallbackUrl,
  ]);

  const hasInsufficientLiquidityError = useMemo(
    () => isInsufficientLiquidityError(error),
    [error],
  );

  const lastToastTimeRef = useRef(0);

  useEffect(() => {
    if (!errorMessage) return;

    logger.error(error);

    const now = Date.now();
    const elapsed = now - lastToastTimeRef.current;

    if (lastToastTimeRef.current === 0 || elapsed >= TOAST_THROTTLE_MS) {
      lastToastTimeRef.current = now;
      toast.error(errorMessage, { id: "swap-quote-error" });
    }
  }, [errorMessage, error]);

  const quoteErrorMessage = useMemo(() => {
    if (!errorMessage) return null;
    return typeof errorMessage === "string" ? errorMessage : null;
  }, [errorMessage]);

  return useMemo(
    () => ({
      isFetching,
      isError: isError || !!error,
      hasInsufficientLiquidityError,
      quoteErrorMessage,
      amountWei: data?.amountWei || "0",
      quoteWei: data?.quoteWei || "0",
      quote: data?.quote || "0",
      rate: data?.rate,
      refetch,
    }),
    [
      isFetching,
      isError,
      error,
      hasInsufficientLiquidityError,
      quoteErrorMessage,
      data,
      refetch,
    ],
  );
}

/**
 * Hook to calculate USD value for a token amount
 */
export function useTokenUSDValue(
  tokenSymbol: TokenSymbol,
  amount: string | number,
) {
  const isStablecoin = useMemo(() => tokenSymbol === "USDm", [tokenSymbol]);
  const hasValidAmount = useMemo(
    () => amount && amount !== "" && Number(amount) > 0,
    [amount],
  );

  // Always call useSwapQuote, but disable it when not needed
  const { quote } = useSwapQuote(
    hasValidAmount ? amount : "",
    tokenSymbol,
    TokenSymbol.USDm,
    {
      skipDebugLogs: true,
      validatePoolLiquidity: false,
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
 * Hook that optimizes swap quotes and USD value calculations.
 * Reduces the number of useSwapQuote calls from 3 to 1 when possible.
 * Only supports exact input swaps (selling exact amount to receive output).
 */
export function useOptimizedSwapQuote(
  amount: string | number,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
  options: Pick<UseSwapQuoteOptions, "insufficientLiquidityFallbackUrl"> = {},
) {
  const mainQuote = useSwapQuote(amount, tokenInSymbol, tokenOutSymbol, {
    insufficientLiquidityFallbackUrl: options.insufficientLiquidityFallbackUrl,
  });

  // Calculate USD values - amount is always the input, quote is always the output
  const fromAmount = amount;
  const toAmount = mainQuote.quote;

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
