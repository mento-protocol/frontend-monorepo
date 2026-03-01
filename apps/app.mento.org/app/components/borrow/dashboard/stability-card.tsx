"use client";

import { useSetAtom } from "jotai";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@repo/ui";
import type { StabilityPoolPosition, DebtTokenConfig } from "@repo/web3";
import {
  useStabilityPoolStats,
  formatDebtAmount,
  formatCollateralAmount,
} from "@repo/web3";
import { borrowViewAtom } from "../atoms/borrow-navigation";

interface StabilityCardProps {
  position: StabilityPoolPosition;
  debtToken: DebtTokenConfig;
}

export function StabilityCard({ position, debtToken }: StabilityCardProps) {
  const setBorrowView = useSetAtom(borrowViewAtom);
  const { data: totalDeposits } = useStabilityPoolStats(debtToken.symbol);

  const poolShare =
    totalDeposits && totalDeposits > 0n
      ? Number((position.deposit * 10000n) / totalDeposits) / 100
      : null;

  function handleClick() {
    setBorrowView("earn");
  }

  return (
    <Card
      className="cursor-pointer transition-shadow hover:shadow-md"
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle>Stability Pool</CardTitle>
        {poolShare !== null && (
          <CardAction>
            <span className="text-muted-foreground text-xs">
              {poolShare.toFixed(2)}% of pool
            </span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Deposit">
            {formatDebtAmount(position.deposit, debtToken)}
          </Metric>
          <Metric label="Collateral Gain">
            {formatCollateralAmount(position.collateralGain)}
          </Metric>
          <Metric label={`${debtToken.symbol} Yield`}>
            {formatDebtAmount(position.debtTokenGain, debtToken)}
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
