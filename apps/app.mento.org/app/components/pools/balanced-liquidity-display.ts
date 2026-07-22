import type { LiquidityQuoteResult, PoolDisplay } from "@repo/web3";
import { formatUnits } from "viem";

export function formatLiquiditySummaryAmount(amount: string): string {
  if (amount === "—") return amount;

  const match = amount.trim().match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!match || (!match[2] && !match[3])) return "0";

  const [, sign, integer, fraction] = match;
  const normalizedInteger = (integer || "0").replace(/^0+(?=\d)/, "");
  const groupedInteger = normalizedInteger.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  return `${sign}${groupedInteger}${fraction === undefined ? "" : `.${fraction}`}`;
}

export interface BalancedLiquidityDisplayState {
  token0Amount: string;
  token1Amount: string;
  summaryToken0Amount: string;
  summaryToken1Amount: string;
}

/**
 * Keeps both balanced inputs and the summary on the same Router quote. Raw
 * input is shown only while there is no executable canonical quote yet.
 */
export function getBalancedLiquidityDisplayState({
  quote,
  pool,
  rawToken0Amount,
  rawToken1Amount,
}: {
  quote: LiquidityQuoteResult | null | undefined;
  pool: PoolDisplay;
  rawToken0Amount: string;
  rawToken1Amount: string;
}): BalancedLiquidityDisplayState {
  if (!quote) {
    return {
      token0Amount: rawToken0Amount,
      token1Amount: rawToken1Amount,
      summaryToken0Amount: formatLiquiditySummaryAmount("0"),
      summaryToken1Amount: formatLiquiditySummaryAmount("0"),
    };
  }

  const token0Amount = formatUnits(quote.amountA, pool.token0.decimals);
  const token1Amount = formatUnits(quote.amountB, pool.token1.decimals);

  return {
    token0Amount,
    token1Amount,
    summaryToken0Amount: formatLiquiditySummaryAmount(token0Amount),
    summaryToken1Amount: formatLiquiditySummaryAmount(token1Amount),
  };
}
