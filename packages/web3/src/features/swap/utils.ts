import {
  DEFAULT_SLIPPAGE_PERCENT,
  MAX_SLIPPAGE_PERCENT,
} from "@/config/constants";
import { getTokenBySymbol, getTokenDecimals } from "@/config/tokens";
import { type NumberT, parseAmountWithDefault, toWei } from "@/utils/amount";
import { logger } from "@/utils/logger";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import BigNumber from "bignumber.js";
import { formatUnits } from "viem";

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
      formatUnits(BigInt(fromAmountWei.toString()), fromDecimals),
    ).dividedBy(formatUnits(BigInt(toAmountWei.toString()), toDecimals));
    if (rate.isFinite()) return rate.toFixed(4, BigNumber.ROUND_DOWN);
    return "0";
  } catch (error) {
    logger.warn("Error computing exchange values", error);
    return "0";
  }
}

export const formatBalance = (value: string, decimals: number): string => {
  try {
    const formatted = formatUnits(BigInt(value), decimals);
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
  const num = new BigNumber(value);
  if (num.isNaN() || !num.isFinite()) return "0";

  // Decimal, arbitrary-precision truncation — no IEEE-754 round-trip.
  const truncated = num.decimalPlaces(maxDecimals, BigNumber.ROUND_DOWN);

  // toFormat() groups thousands with ","; toFixed() (no dp arg) emits no trailing zeros.
  return useThousandSeparators ? truncated.toFormat() : truncated.toFixed();
};

export function parseSlippage(slippage?: string): number {
  const parsed = Number.parseFloat(slippage ?? "");
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > MAX_SLIPPAGE_PERCENT
  ) {
    return DEFAULT_SLIPPAGE_PERCENT;
  }
  return parsed;
}

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
