"use client";

import { useSetAtom } from "jotai";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@repo/ui";
import type { DebtTokenConfig, StabilityPoolPosition } from "@repo/web3";
import { formatDebtAmount, formatCollateralAmount } from "@repo/web3";
import { borrowViewAtom } from "../atoms/borrow-navigation";

interface StabilityPoolCardProps {
  position: StabilityPoolPosition;
  debtToken: DebtTokenConfig;
}

export function StabilityPoolCard({
  position,
  debtToken,
}: StabilityPoolCardProps) {
  const setBorrowView = useSetAtom(borrowViewAtom);

  const hasRewards =
    position.collateralGain > 0n || position.debtTokenGain > 0n;

  return (
    <Card
      className="hover:shadow-md relative cursor-pointer transition-shadow"
      onClick={() => setBorrowView("earn")}
    >
      <div className="top-4 right-4 absolute">
        <Badge
          variant="outline"
          className="bg-blue-100 text-blue-800 border-blue-200"
        >
          Stability Pool
        </Badge>
      </div>
      <CardHeader>
        <CardTitle>Earn</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="gap-x-6 gap-y-3 grid grid-cols-3">
          <Metric label="Your Deposit">
            {formatDebtAmount(position.deposit, debtToken)}
          </Metric>
          <Metric label="Collateral Gain">
            {formatCollateralAmount(position.collateralGain)}
          </Metric>
          <Metric label={`${debtToken.symbol} Yield`}>
            {formatDebtAmount(position.debtTokenGain, debtToken)}
          </Metric>
        </div>
        {hasRewards && (
          <p className="mt-3 text-xs text-primary">
            Rewards available to claim
          </p>
        )}
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
    <div className="gap-0.5 flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
