import { useMemo } from "react";
import { useInterestRateBrackets } from "./use-interest-rate-brackets";

const DECIMALS = 10n ** 18n;

export interface InterestRateChartPoint {
  rate: number;
  debt: number;
  isCurrentRate: boolean;
}

export function useInterestRateChartData(
  currentRate?: bigint | null,
  symbol = "GBPm",
) {
  const { data: brackets } = useInterestRateBrackets(symbol);

  return useMemo<InterestRateChartPoint[] | null>(() => {
    if (brackets == null) return null;

    return brackets.map((bracket) => ({
      rate: Number((bracket.rate * 10000n) / DECIMALS) / 100,
      debt: Number(bracket.totalDebt / DECIMALS),
      isCurrentRate:
        currentRate != null && bracket.rate === currentRate,
    }));
  }, [brackets, currentRate]);
}
