import { getTokenDecimals } from "@/config/tokens";
import { toWei } from "@/utils/amount";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";

/**
 * Calculates the required reserve balance in wei based on swap direction.
 * For swapIn: uses quoteWei (expected amount to receive)
 * For swapOut: calculates from amount (exact amount to buy)
 *
 * @param direction - Swap direction: "in" (swapIn) or "out" (swapOut)
 * @param quoteWei - Quote amount in wei (for swapIn direction). May be undefined if quote not yet available.
 * @param amount - Amount string (for swapOut direction)
 * @param tokenOutSymbol - Token symbol being received
 * @param chainId - Chain ID for token decimals lookup
 * @returns Required reserve balance in wei, or undefined if amount is invalid/zero or quoteWei is undefined (for swapIn)
 */
export function calculateRequiredReserveBalance(
  direction: "in" | "out",
  quoteWei: string | undefined,
  amount: string | undefined,
  tokenOutSymbol: TokenSymbol,
  chainId: number,
): string | undefined {
  // Validate amount is present and non-zero.
  if (!amount || amount === "0" || amount === "0.") {
    return undefined;
  }

  if (direction === "in") {
    // swapIn: expected amount of toToken to receive (quoteWei).
    return quoteWei;
  }

  // swapOut: exact amount of toToken to buy.
  return toWei(amount, getTokenDecimals(tokenOutSymbol, chainId)).toFixed(0);
}

/**
 * Determines if the reserve balance check should be enabled based on required conditions.
 *
 * @param enabled - Whether the check is enabled by the caller
 * @param chainId - The chain ID (must be defined)
 * @param requiredReserveBalanceInWei - The required balance in wei (must be defined and non-zero)
 * @param reserveAddress - The reserve contract address (must be defined)
 * @returns True if all conditions are met for the check to run
 */
export function shouldCheckReserveBalance(
  enabled: boolean,
  chainId: number | undefined,
  requiredReserveBalanceInWei: string | undefined,
  reserveAddress: Address | undefined,
): boolean {
  return (
    enabled &&
    !!chainId &&
    !!requiredReserveBalanceInWei &&
    requiredReserveBalanceInWei !== "0" &&
    !!reserveAddress
  );
}
