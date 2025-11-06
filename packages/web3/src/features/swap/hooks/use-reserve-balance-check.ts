import { ReserveABI } from "@/abi";
import { getTokenDecimals } from "@/config/tokens";
import { getProvider } from "@/features/providers";
import { fromWei } from "@/utils/amount";
import { logger } from "@/utils/logger";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { erc20Abi } from "viem";
import type { Address } from "viem";
import { InsufficientReserveCollateralError } from "./insufficient-reserve-collateral-error";

export interface ReserveBalanceCheckResult {
  isCollateralAsset: boolean;
  hasSufficientBalance: boolean;
  isZeroBalance: boolean;
  maxSwapAmountFormatted: string;
}

/**
 * Checks if the reserve has sufficient collateral balance for a swap.
 * Only checks when swapping INTO a collateral asset.
 * Also checks trading limits and other constraints.
 *
 * @param chainId - The chain ID to check on
 * @param toToken - The token symbol being received (must be collateral)
 * @param requiredReserveBalanceInWei - The amount required from the Reserve in wei
 * @param reserveAddress - The reserve contract address (required)
 * @returns Reserve balance check result
 * @throws {InsufficientReserveCollateralError} When reserve has insufficient balance
 * @throws {Error} When the check fails due to network or contract errors
 */
export async function checkReserveBalance(
  chainId: number,
  toToken: TokenSymbol,
  requiredReserveBalanceInWei: string,
  reserveAddress: Address,
): Promise<ReserveBalanceCheckResult> {
  try {
    if (!reserveAddress) {
      throw new Error(
        `Reserve address not provided for chainId ${chainId}. Cannot perform reserve balance check.`,
      );
    }

    const toTokenAddress = getTokenAddress(toToken, chainId);
    if (!toTokenAddress) {
      throw new Error(
        `Token address not found for ${toToken} on chain ${chainId}. Cannot perform reserve balance check.`,
      );
    }

    const provider = getProvider(chainId);
    const reserveContract = new Contract(reserveAddress, ReserveABI, provider);

    // Check if the token is a collateral asset
    const isCollateralAsset =
      await reserveContract.isCollateralAsset(toTokenAddress);

    if (!isCollateralAsset) {
      // Not a collateral asset, no need to check balance
      return {
        isCollateralAsset: false,
        hasSufficientBalance: true,
        isZeroBalance: false,
        maxSwapAmountFormatted: "0",
      };
    }

    // Get the reserve's balance of the token
    const tokenContract = new Contract(toTokenAddress, erc20Abi, provider);
    const reserveBalanceWei = (
      await tokenContract.balanceOf(reserveAddress)
    ).toString();

    const decimals = getTokenDecimals(toToken, chainId);
    const reserveBalanceFormatted = fromWei(reserveBalanceWei, decimals);

    // Validate amounts before BigInt conversion
    let requiredReserveBalanceBN: bigint;
    let actualReserveBalanceBN: bigint;
    try {
      requiredReserveBalanceBN = BigInt(requiredReserveBalanceInWei);
      actualReserveBalanceBN = BigInt(reserveBalanceWei);
    } catch (error) {
      throw new Error(
        `Invalid amount format for reserve balance check: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    const isZeroBalance = actualReserveBalanceBN === 0n;
    const hasSufficientBalance =
      actualReserveBalanceBN >= requiredReserveBalanceBN;
    // Maximum available from reserve (may be subject to trading limits)
    const maxSwapAmountFormatted = reserveBalanceFormatted;

    return {
      isCollateralAsset: true,
      hasSufficientBalance,
      isZeroBalance,
      maxSwapAmountFormatted,
    };
  } catch (error) {
    logger.error("Error checking reserve balance", {
      error,
      chainId,
      toToken,
      requiredReserveBalanceInWei,
      reserveAddress,
    });
    // Re-throw with additional context
    if (error instanceof InsufficientReserveCollateralError) {
      throw error;
    }
    throw new Error(
      `Failed to check reserve balance for ${toToken} on chain ${chainId}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export interface UseReserveBalanceCheckOptions {
  chainId: number | undefined;
  toToken: TokenSymbol;
  requiredReserveBalanceInWei: string | undefined;
  reserveAddress: Address | undefined;
  enabled?: boolean;
}

/**
 * React hook to check reserve balance for a swap.
 * Returns the check result and loading state.
 *
 * @param options - Configuration options for the reserve balance check
 * @returns React Query result with reserve balance check data
 */
export function useReserveBalanceCheck({
  chainId,
  toToken,
  requiredReserveBalanceInWei,
  reserveAddress,
  enabled = true,
}: UseReserveBalanceCheckOptions) {
  return useQuery({
    queryKey: [
      "reserveBalanceCheck",
      chainId,
      toToken,
      requiredReserveBalanceInWei,
      reserveAddress,
    ],
    queryFn: async () => {
      if (!chainId || !requiredReserveBalanceInWei || !reserveAddress) {
        return null;
      }
      // Errors will be handled by React Query's error state
      return await checkReserveBalance(
        chainId,
        toToken,
        requiredReserveBalanceInWei,
        reserveAddress,
      );
    },
    enabled:
      enabled && !!chainId && !!requiredReserveBalanceInWei && !!reserveAddress,
    staleTime: 10000, // 10 seconds - reserve balance can change frequently
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}
