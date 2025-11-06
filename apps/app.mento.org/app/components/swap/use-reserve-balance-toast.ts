import {
  getReserveBalanceErrorMessage,
  getTokenBySymbol,
  InsufficientReserveCollateralError,
  type ReserveBalanceCheckResult,
} from "@repo/web3";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

const RESERVE_BALANCE_TOAST_ID = "reserve-balance-error";

interface UseReserveBalanceToastParams {
  reserveCheck: ReserveBalanceCheckResult | null | undefined;
  reserveCheckError: Error | null;
  isReserveCheckLoading: boolean;
  chainId: number | undefined;
  tokenOutSymbol: TokenSymbol;
}

/**
 * Hook to show a toast notification when reserve balance check fails.
 * Prevents duplicate toasts by using a consistent toast ID and tracking the last shown message.
 * Returns `hasInsufficientReserveBalance` for use in disabling buttons, etc.
 *
 * @param params - Configuration parameters
 * @param params.reserveCheck - The reserve balance check result (may be null/undefined)
 * @param params.reserveCheckError - Any error that occurred during the check
 * @param params.isReserveCheckLoading - Whether the check is currently loading
 * @param params.chainId - The chain ID (used for token symbol lookup, may be undefined)
 * @param params.tokenOutSymbol - The token symbol being received
 * @returns Object with `hasInsufficientReserveBalance` boolean flag
 */
export function useReserveBalanceToast({
  reserveCheck,
  reserveCheckError,
  isReserveCheckLoading,
  chainId,
  tokenOutSymbol,
}: UseReserveBalanceToastParams) {
  // Calculate if there's insufficient reserve balance
  const hasInsufficientReserveBalance = useMemo(
    () =>
      (reserveCheck?.isCollateralAsset && !reserveCheck.hasSufficientBalance) ||
      !!reserveCheckError,
    [reserveCheck, reserveCheckError],
  );

  // Track the last error message we showed to prevent duplicate toasts
  const lastShownErrorMessage = useRef<string | null>(null);

  useEffect(() => {
    if (hasInsufficientReserveBalance && !isReserveCheckLoading && chainId) {
      const toTokenObj = getTokenBySymbol(tokenOutSymbol, chainId);
      const toTokenSymbol = toTokenObj?.symbol || tokenOutSymbol;

      // Determine if this is a network error (not an InsufficientReserveCollateralError)
      const isNetworkError =
        !!reserveCheckError &&
        !(reserveCheckError instanceof InsufficientReserveCollateralError);

      // Use shared utility to generate error message
      const errorMessage = getReserveBalanceErrorMessage(
        reserveCheckError || reserveCheck || null,
        toTokenSymbol,
        isNetworkError,
      );

      // Only show/update toast if the error message has changed
      if (lastShownErrorMessage.current !== errorMessage) {
        toast.error(errorMessage, {
          id: RESERVE_BALANCE_TOAST_ID, // Use consistent ID to update same toast
          duration: Infinity, // Make toast permanent until user closes it manually
        });
        lastShownErrorMessage.current = errorMessage;
      }
    } else if (!hasInsufficientReserveBalance && !isReserveCheckLoading) {
      // Dismiss the toast when balance becomes sufficient and not loading
      toast.dismiss(RESERVE_BALANCE_TOAST_ID);
      lastShownErrorMessage.current = null;
    }
  }, [
    hasInsufficientReserveBalance,
    reserveCheck,
    reserveCheckError,
    isReserveCheckLoading,
    chainId,
    tokenOutSymbol,
  ]);

  return { hasInsufficientReserveBalance };
}
