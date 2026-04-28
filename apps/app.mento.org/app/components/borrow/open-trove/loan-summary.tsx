"use client";

import {
  type DebtTokenConfig,
  useLoanDetails,
  usePredictUpfrontFee,
  formatLtv,
  formatPrice,
  formatDebtAmount,
  formatCollateralAmount,
  formatInterestRate,
} from "@repo/web3";
import { useMemo } from "react";

interface LoanSummaryProps {
  debtToken: DebtTokenConfig;
  collateralSymbol: string;
  collAmount: bigint;
  debtAmount: bigint;
  interestRate: bigint;
}

const PLACEHOLDER = "\u2014";

function MetricRow({
  label,
  children,
  divider,
}: {
  label: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`py-2.5 flex items-center justify-between ${
        divider ? "mt-1 pt-3 border-t border-border/30" : ""
      }`}
    >
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold">{children}</span>
    </div>
  );
}

export function LoanSummary({
  debtToken,
  collateralSymbol,
  collAmount,
  debtAmount,
  interestRate,
}: LoanSummaryProps) {
  const hasInputs = collAmount > 0n && debtAmount > 0n;

  const loanDetails = useLoanDetails(
    hasInputs ? collAmount : null,
    hasInputs ? debtAmount : null,
    interestRate > 0n ? interestRate : null,
    debtToken.symbol,
  );

  const { data: upfrontFee } = usePredictUpfrontFee(
    debtAmount,
    interestRate,
    debtToken.symbol,
  );

  const annualCost = useMemo(() => {
    if (debtAmount === 0n || interestRate === 0n) return null;
    return (debtAmount * interestRate) / 10n ** 18n;
  }, [debtAmount, interestRate]);

  return (
    <div className="p-6 top-6 sticky border border-border/50 bg-card">
      <div className="mb-5 font-semibold tracking-wide text-[13px] text-muted-foreground/70">
        Loan Summary
      </div>

      <div className="flex flex-col">
        <MetricRow label="Collateral">
          {hasInputs
            ? formatCollateralAmount(collAmount, collateralSymbol)
            : PLACEHOLDER}
        </MetricRow>
        <MetricRow label="Debt">
          {hasInputs ? formatDebtAmount(debtAmount, debtToken) : PLACEHOLDER}
        </MetricRow>
        <MetricRow label="Liq. Price">
          {loanDetails
            ? formatPrice(
                loanDetails.liquidationPrice,
                debtToken,
                collateralSymbol,
              )
            : PLACEHOLDER}
        </MetricRow>

        <MetricRow label="Collateral Ratio" divider>
          {loanDetails?.ltv != null && loanDetails.ltv > 0n
            ? formatLtv(10n ** 36n / loanDetails.ltv)
            : PLACEHOLDER}
        </MetricRow>
        <MetricRow label="Interest Rate">
          {interestRate > 0n ? formatInterestRate(interestRate) : PLACEHOLDER}
        </MetricRow>
        <MetricRow label="One-time Fee">
          {upfrontFee != null
            ? formatDebtAmount(upfrontFee, debtToken)
            : PLACEHOLDER}
        </MetricRow>
        <MetricRow label="Annual Cost">
          {annualCost != null
            ? formatDebtAmount(annualCost, debtToken)
            : PLACEHOLDER}
        </MetricRow>
      </div>
    </div>
  );
}
