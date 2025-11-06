import {
  formatWithMaxDecimals,
  getTokenBySymbol,
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

      let errorMessage: string;

      // Handle error case (network/contract error)
      if (reserveCheckError) {
        errorMessage = `Unable to check reserve balance for ${toTokenSymbol}. Please try again.`;
      } else if (reserveCheck) {
        // Handle insufficient balance case
        if (reserveCheck.isZeroBalance) {
          errorMessage = `The Reserve is currently out of ${toTokenSymbol} and will be refilled soon.`;
        } else if (reserveCheck.maxSwapAmountFormatted) {
          const maxSwapAmountFormatted = formatWithMaxDecimals(
            reserveCheck.maxSwapAmountFormatted,
            4,
          );
          errorMessage = `Swap amount too high. The Reserve does not have enough ${toTokenSymbol} to execute your trade. You can only swap up to ${maxSwapAmountFormatted} ${toTokenSymbol} at the moment.`;
        } else {
          errorMessage = `Swap amount too high. The Reserve does not have enough ${toTokenSymbol} to execute your trade.`;
        }
      } else {
        // Fallback message
        errorMessage = `Swap amount too high. The Reserve does not have enough ${toTokenSymbol} to execute your trade.`;
      }

      // Only show/update toast if the error message has changed
      if (lastShownErrorMessage.current !== errorMessage) {
        toast.error(errorMessage, {
          id: RESERVE_BALANCE_TOAST_ID, // Use consistent ID to update same toast
          duration: Infinity, // Make toast permanent until user closes it manually
        });
        lastShownErrorMessage.current = errorMessage;
      }
    } else if (!hasInsufficientReserveBalance) {
      // Dismiss the toast when balance becomes sufficient
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
