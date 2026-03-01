"use client";

import { useSetAtom } from "jotai";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import {
  useLoanDetails,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
  formatPrice,
  formatInterestRate,
} from "@repo/web3";
import { RiskBadge } from "../shared/risk-badge";
import { borrowViewAtom } from "../atoms/borrow-navigation";

interface PositionCardProps {
  position: BorrowPosition;
  debtToken: DebtTokenConfig;
}

export function PositionCard({ position, debtToken }: PositionCardProps) {
  const setBorrowView = useSetAtom(borrowViewAtom);

  const loanDetails = useLoanDetails(
    position.collateral,
    position.debt,
    position.annualInterestRate,
    debtToken.symbol,
  );

  function handleClick() {
    setBorrowView({ view: "manage-trove", troveId: position.troveId });
  }

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle>Trove #{position.troveId}</CardTitle>
        <CardAction>
          <RiskBadge risk={loanDetails?.liquidationRisk ?? null} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Collateral">
            {formatCollateralAmount(position.collateral)}
          </Metric>
          <Metric label="Debt">
            {formatDebtAmount(position.debt, debtToken)}
          </Metric>
          <Metric label="LTV">{formatLtv(loanDetails?.ltv ?? null)}</Metric>
          <Metric label="Liq. Price">
            {formatPrice(loanDetails?.liquidationPrice ?? null, debtToken)}
          </Metric>
          <Metric label="Interest Rate">
            {formatInterestRate(position.annualInterestRate)}
          </Metric>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
