import { getTokenBySymbol, getTokenDecimals } from "@/config/tokens";
import { type NumberT, parseAmountWithDefault, toWei } from "@/utils/amount";
import { logger } from "@/utils/logger";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import BigNumber from "bignumber.js";
import { ethers } from "ethers";

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
 * Validates if a token pair is valid for swapping
 * @param tokenInSymbol - The input token symbol
 * @param tokenOutSymbol - The output token symbol
 * @param fromToken - The token object for tokenInSymbol (from getTokenBySymbol)
 * @param toToken - The token object for tokenOutSymbol (from getTokenBySymbol)
 * @returns true if the pair is valid for swapping
 */
export function isValidTokenPair(
  tokenInSymbol: string | undefined,
  tokenOutSymbol: string | undefined,
  fromToken: ReturnType<typeof getTokenBySymbol> | null,
  toToken: ReturnType<typeof getTokenBySymbol> | null,
): boolean {
  return (
    !!tokenInSymbol &&
    !!tokenOutSymbol &&
    tokenInSymbol !== tokenOutSymbol &&
    !!fromToken &&
    !!toToken
  );
}
