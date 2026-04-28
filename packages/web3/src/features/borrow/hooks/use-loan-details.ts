import { useMemo } from "react";
import { getLoanDetails } from "@mento-protocol/mento-sdk";
import type { LoanDetails } from "../types";
import { useCollateralPrice } from "./use-collateral-price";
import { useSystemParams } from "./use-system-params";

export function useLoanDetails(
  collAmount: bigint | null,
  debtAmount: bigint | null,
  interestRate: bigint | null,
  symbol = "GBPm",
) {
  const { data: price } = useCollateralPrice(symbol);
  const { data: systemParams } = useSystemParams(symbol);

  return useMemo<LoanDetails | null>(() => {
    if (systemParams == null) return null;

    return getLoanDetails(
      collAmount,
      debtAmount,
      interestRate,
      price ?? null,
      systemParams.mcr,
    );
  }, [collAmount, debtAmount, interestRate, price, systemParams]);
}
