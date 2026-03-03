import { useMemo } from "react";
import { getRedemptionRisk } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowMath";
import type { RiskLevel } from "../types";
import { useInterestRateBrackets } from "./use-interest-rate-brackets";

export function useRedemptionRisk(
  interestRate: bigint | null,
  symbol = "GBPm",
) {
  const { data: brackets } = useInterestRateBrackets(symbol);

  return useMemo<RiskLevel | null>(() => {
    if (interestRate == null || brackets == null) return null;

    let debtInFront = 0n;
    let totalDebt = 0n;
    for (const bracket of brackets) {
      totalDebt += bracket.totalDebt;
      if (bracket.rate < interestRate) {
        debtInFront += bracket.totalDebt;
      }
    }

    if (totalDebt === 0n) return null;

    return getRedemptionRisk(debtInFront, totalDebt);
  }, [interestRate, brackets]);
}
