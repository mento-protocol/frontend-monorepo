"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import {
  useLoanDetails,
  usePredictUpfrontFee,
  formatLtv,
  formatPrice,
  formatDebtAmount,
  formatCollateralAmount,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { RiskBadge } from "../shared/risk-badge";

interface LoanSummaryProps {
  collAmount: bigint;
  debtAmount: bigint;
  interestRate: bigint;
}

const PLACEHOLDER = "\u2014";

function MetricRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1.5 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function LoanSummary({
  collAmount,
  debtAmount,
  interestRate,
}: LoanSummaryProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);

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

  const muted = !hasInputs;

  return (
    <Card className={muted ? "opacity-60" : undefined}>
      <CardHeader>
        <CardTitle className="text-sm">Loan Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col divide-y">
          <MetricRow label="Collateral">
            {hasInputs ? formatCollateralAmount(collAmount) : PLACEHOLDER}
          </MetricRow>
          <MetricRow label="Debt">
            {hasInputs ? formatDebtAmount(debtAmount, debtToken) : PLACEHOLDER}
          </MetricRow>
          <MetricRow label="LTV">
            <span className="gap-2 flex items-center">
              {loanDetails ? formatLtv(loanDetails.ltv) : PLACEHOLDER}
              {loanDetails && <RiskBadge risk={loanDetails.liquidationRisk} />}
            </span>
          </MetricRow>
          <MetricRow label="Liquidation Price">
            {loanDetails
              ? formatPrice(loanDetails.liquidationPrice, debtToken)
              : PLACEHOLDER}
          </MetricRow>
          <MetricRow label="Collateral Ratio">
            {loanDetails?.ltv != null && loanDetails.ltv > 0n
              ? formatLtv(10n ** 36n / loanDetails.ltv)
              : PLACEHOLDER}
          </MetricRow>
          <MetricRow label="One-time Fee">
            {upfrontFee != null
              ? formatDebtAmount(upfrontFee, debtToken)
              : PLACEHOLDER}
          </MetricRow>
          <MetricRow label="Annual Interest Cost">
            {annualCost != null
              ? formatDebtAmount(annualCost, debtToken)
              : PLACEHOLDER}
          </MetricRow>
        </div>
      </CardContent>
    </Card>
  );
}
