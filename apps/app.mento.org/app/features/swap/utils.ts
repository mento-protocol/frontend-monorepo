import BigNumber from "bignumber.js";
import { ethers } from "ethers";
import { type TokenId, Tokens } from "@/lib/config/tokens";
import {
  type NumberT,
  parseAmountWithDefault,
  toWei,
} from "@/lib/utils/amount";
import { logger } from "@/lib/utils/logger";

export function parseInputExchangeAmount(
  amount: NumberT | null | undefined,
  tokenId: TokenId,
  isWei = false,
) {
  const parsed = parseAmountWithDefault(amount, 0);
  const parsedWei = isWei ? parsed : toWei(parsed, Tokens[tokenId].decimals);
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
