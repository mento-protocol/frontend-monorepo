import { getTokenDecimals } from "@/config/tokens";
import { type NumberT, parseAmountWithDefault, toWei } from "@/utils/amount";
import { logger } from "@/utils/logger";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import BigNumber from "bignumber.js";
import { ethers } from "ethers";
import type { ReserveBalanceCheckResult } from "./hooks/use-reserve-balance-check";

export * from "./utils/reserve-balance";

export function parseInputExchangeAmount(
  amount: NumberT | null | undefined,
  tokenSymbol: TokenSymbol,
  chainId: number,
  isWei = false,
) {
  const parsed = parseAmountWithDefault(amount, 0);
  const decimals = getTokenDecimals(tokenSymbol, chainId);
  const parsedWei = isWei ? parsed : toWei(parsed, decimals);
  return BigNumber.max(parsedWei, 0).toFixed(0);
}

export function getMinBuyAmount(
  amountInWei: BigNumber.Value,
  slippage: BigNumber.Value,
): BigNumber {
  const slippageFactor = new BigNumber(slippage).div(100).minus(1).times(-1);
  return new BigNumber(amountInWei).times(slippageFactor).decimalPlaces(0);
}

export function getMaxSellAmount(
  amountInWei: BigNumber.Value,
  slippage: BigNumber.Value,
): BigNumber {
  const slippageFactor = new BigNumber(slippage).div(100).plus(1);
  return new BigNumber(amountInWei).times(slippageFactor).decimalPlaces(0);
}

export function calcExchangeRate(
  fromAmountWei: NumberT,
  fromDecimals: number,
  toAmountWei: NumberT,
  toDecimals: number,
) {
  try {
    const rate = new BigNumber(
      ethers.utils.formatUnits(fromAmountWei.toString(), fromDecimals),
    ).dividedBy(ethers.utils.formatUnits(toAmountWei.toString(), toDecimals));
    if (rate.isFinite()) return rate.toFixed(4, BigNumber.ROUND_DOWN);
    return "0";
  } catch (error) {
    logger.warn("Error computing exchange values", error);
    return "0";
  }
}

export function invertExchangeRate(rate: NumberT) {
  try {
    const inverted = new BigNumber(1).dividedBy(rate);
    if (inverted.isFinite()) return inverted.toFixed(4, BigNumber.ROUND_DOWN);
    return "0";
  } catch (error) {
    logger.warn("Error inverting exchange values", error);
    return "0";
  }
}

export const formatBalance = (value: string, decimals: number): string => {
  try {
    const formatted = ethers.utils.formatUnits(value, decimals);
    const decimalPoint = formatted.indexOf(".");
    if (decimalPoint === -1) return formatted;
    return formatted.slice(0, decimalPoint + 5);
  } catch {
    return "0";
  }
};

export const formatWithMaxDecimals = (
  value: string,
  maxDecimals = 4,
  useThousandSeparators = true,
): string => {
  if (!value || value === "0") return "0";
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return "0";

  // If the number has more decimals than allowed, truncate it
  const factor = 10 ** maxDecimals;
  const truncated = Math.floor(num * factor) / factor;

  // Format with or without thousand separators based on the parameter
  if (useThousandSeparators) {
    return truncated.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
    });
  } else {
    // Return plain number string without thousand separators for form inputs
    return truncated.toFixed(maxDecimals).replace(/\.?0+$/, "");
  }
};

/**
 * Generates a user-friendly error message for insufficient reserve balance.
 * Handles ReserveBalanceCheckResult objects and Error instances.
 *
 * @param errorOrResult - Either a ReserveBalanceCheckResult with insufficient balance or an Error
 * @param tokenSymbol - The token symbol for fallback messages
 * @param isNetworkError - Whether this is a network/contract error (not insufficient balance)
 * @returns User-friendly error message
 */
export function getReserveBalanceErrorMessage(
  errorOrResult: ReserveBalanceCheckResult | Error | null | undefined,
  tokenSymbol: string,
  isNetworkError = false,
): string {
  // Handle network/contract errors.
  if (isNetworkError || errorOrResult instanceof Error) {
    return `Unable to check reserve balance for ${tokenSymbol}. Please try again.`;
  }

  // Handle ReserveBalanceCheckResult.
  if (
    errorOrResult &&
    !(errorOrResult instanceof Error) &&
    "isCollateralAsset" in errorOrResult
  ) {
    const result = errorOrResult;
    if (result.isZeroBalance) {
      return `The Reserve is currently out of ${tokenSymbol} and will be refilled soon.`;
    } else if (result.maxSwapAmountFormatted) {
      const maxSwapAmountFormatted = formatWithMaxDecimals(
        result.maxSwapAmountFormatted,
        4,
      );
      return `Swap amount too high. The Reserve does not have enough ${tokenSymbol} to execute your trade. You can only swap up to ${maxSwapAmountFormatted} ${tokenSymbol} at the moment.`;
    } else {
      return `Swap amount too high. The Reserve does not have enough ${tokenSymbol} to execute your trade.`;
    }
  }

  // Fallback message.
  return `Swap amount too high. The Reserve does not have enough ${tokenSymbol} to execute your trade.`;
}
