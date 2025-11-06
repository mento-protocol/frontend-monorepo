import { useContracts, useReserveBalanceCheck } from "@repo/web3";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { useReserveBalanceToast } from "./use-reserve-balance-toast";

interface UseReserveBalanceOptions {
  chainId: number | undefined;
  tokenOutSymbol: TokenSymbol;
  requiredReserveBalanceInWei: string | undefined;
  enabled?: boolean;
}

/**
 * Combined hook that handles reserve balance checking and toast notifications.
 * The caller should use `calculateRequiredReserveBalance` utility to calculate
 * `requiredReserveBalanceInWei` based on swap direction.
 *
 * Returns derived state for use in disabling buttons, etc.
 */
export function useReserveBalance({
  chainId,
  tokenOutSymbol,
  requiredReserveBalanceInWei,
  enabled = true,
}: UseReserveBalanceOptions) {
  const contracts = useContracts();
  const reserveAddress = contracts.Reserve?.address;

  // Perform reserve balance check
  const {
    data: reserveCheck,
    isLoading: isReserveCheckLoading,
    error: reserveCheckError,
  } = useReserveBalanceCheck({
    chainId,
    toToken: tokenOutSymbol,
    requiredReserveBalanceInWei,
    reserveAddress,
    enabled:
      enabled &&
      !!chainId &&
      !!requiredReserveBalanceInWei &&
      requiredReserveBalanceInWei !== "0" &&
      !!reserveAddress,
  });

  // Show toast and get derived state
  const { hasInsufficientReserveBalance } = useReserveBalanceToast({
    reserveCheck,
    reserveCheckError,
    isReserveCheckLoading,
    chainId,
    tokenOutSymbol,
  });

  return {
    hasInsufficientReserveBalance,
    isReserveCheckLoading,
  };
}
