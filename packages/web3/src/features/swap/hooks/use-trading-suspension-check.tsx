import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChainId } from "wagmi";

import { getMentoSdk } from "@/features/sdk";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";

interface TradingSuspensionCheckResult {
  isSuspended: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to check if trading is suspended for a token pair
 * Uses the SDK's isPairTradable() method to check trading suspension
 * Always runs a fresh query when tokens change - no caching
 */
export function useTradingSuspensionCheck(
  tokenInSymbol: TokenSymbol | undefined,
  tokenOutSymbol: TokenSymbol | undefined,
): TradingSuspensionCheckResult {
  const chainId = useChainId();

  // Query key based on token symbols - React Query will automatically refetch when this changes
  const queryKey = useMemo(
    () => ["trading-suspension-check", tokenInSymbol, tokenOutSymbol, chainId],
    [tokenInSymbol, tokenOutSymbol, chainId],
  );

  // Enable query if we have both token symbols
  const isEnabled =
    !!tokenInSymbol && !!tokenOutSymbol && tokenInSymbol !== tokenOutSymbol;

  const { data, isLoading, error } = useQuery<{
    isSuspended: boolean;
  }>({
    queryKey,
    queryFn: async () => {
      if (!tokenInSymbol || !tokenOutSymbol) {
        console.warn(`[Trading Suspension Check] Missing token symbols:`, {
          tokenInSymbol,
          tokenOutSymbol,
        });
        return { isSuspended: false };
      }

      const fromTokenAddr = getTokenAddress(tokenInSymbol, chainId);
      const toTokenAddr = getTokenAddress(tokenOutSymbol, chainId);

      if (!fromTokenAddr || !toTokenAddr) {
        console.warn(`[Trading Suspension Check] Token addresses not found:`, {
          tokenInSymbol,
          tokenOutSymbol,
          fromTokenAddr,
          toTokenAddr,
          chainId,
        });
        return { isSuspended: false };
      }

      try {
        const mento = await getMentoSdk(chainId);

        const isTradable = await mento.isPairTradable(
          fromTokenAddr,
          toTokenAddr,
        );

        if (!isTradable) {
          return {
            isSuspended: true,
          };
        }

        return { isSuspended: false };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const isNoExchangeError = errorMessage.includes("No exchange found");

        console.error(
          `[Trading Suspension Check] Error checking isPairTradable(${tokenInSymbol} -> ${tokenOutSymbol}):`,
          err,
        );

        // If no exchange is found, treat it as suspended since trading can't happen without an exchange
        if (isNoExchangeError) {
          return {
            isSuspended: true,
          };
        }

        // For other errors, return not suspended to avoid blocking the UI
        return { isSuspended: false };
      }
    },
    enabled: isEnabled,
    staleTime: 0, // Always consider data stale
    gcTime: 0, // Don't cache results
    retry: false, // Don't retry - trading suspension is a definitive state
  });

  return useMemo(
    () => ({
      isSuspended: data?.isSuspended ?? false,
      isLoading,
      error: error instanceof Error ? error : null,
    }),
    [data, isLoading, error],
  );
}
