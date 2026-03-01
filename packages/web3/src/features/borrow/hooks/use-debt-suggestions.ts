import { useMemo } from "react";
import { calculateDebtSuggestions } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowMath";
import { useLoanDetails } from "./use-loan-details";
import { useSystemParams } from "./use-system-params";

export function useDebtSuggestions(collAmount: bigint | null, symbol = "GBPm") {
  const loanDetails = useLoanDetails(collAmount, null, null, symbol);
  const { data: systemParams } = useSystemParams(symbol);

  return useMemo(() => {
    if (loanDetails?.maxDebt == null || systemParams == null) return null;

    return calculateDebtSuggestions(loanDetails.maxDebt, systemParams.minDebt);
  }, [loanDetails, systemParams]);
}
