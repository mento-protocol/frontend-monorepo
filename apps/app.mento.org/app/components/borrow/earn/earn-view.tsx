"use client";

import { useAtomValue, useSetAtom } from "jotai";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useStabilityPool,
  useStabilityPoolStats,
  formatDebtAmount,
  formatCollateralAmount,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { borrowViewAtom } from "../atoms/borrow-navigation";

export function EarnView() {
  const { address, isConnected } = useAccount();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);

  const { data: spPosition, isLoading: spLoading } = useStabilityPool(
    debtToken.symbol,
  );
  const { data: totalDeposits, isLoading: statsLoading } =
    useStabilityPoolStats(debtToken.symbol);

  const isLoading = spLoading || statsLoading;
  const hasDeposit = spPosition && spPosition.deposit > 0n;

  const poolShare =
    hasDeposit && totalDeposits && totalDeposits > 0n
      ? Number((spPosition.deposit * 10000n) / totalDeposits) / 100
      : null;

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={() => setBorrowView("dashboard")}>
        &larr; Back to Dashboard
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Stability Pool</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Deposit {debtToken.symbol} to earn rewards from liquidations and
            protocol yield.
          </p>
        </CardContent>
      </Card>

      {/* Pool Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>Pool Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-8 w-32 animate-pulse rounded bg-muted" />
          ) : (
            <div className="gap-1 flex flex-col">
              <span className="text-xs text-muted-foreground">
                Total Deposits
              </span>
              <span className="text-sm font-medium">
                {formatDebtAmount(totalDeposits ?? null, debtToken)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Position / States */}
      {!isConnected ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              Connect your wallet to view your Stability Pool position.
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent>
            <div className="gap-4 grid grid-cols-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : hasDeposit ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Position</CardTitle>
            {poolShare !== null && (
              <CardAction>
                <span className="text-xs text-muted-foreground">
                  {poolShare.toFixed(2)}% of pool
                </span>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <div className="gap-4 grid grid-cols-2">
              <Metric label="Deposit">
                {formatDebtAmount(spPosition.deposit, debtToken)}
              </Metric>
              <Metric label="Collateral Gain">
                {formatCollateralAmount(spPosition.collateralGain)}
              </Metric>
              <Metric label={`${debtToken.symbol} Yield`}>
                {formatDebtAmount(spPosition.debtTokenGain, debtToken)}
              </Metric>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              You have no Stability Pool deposit yet. Deposit {debtToken.symbol}{" "}
              below to start earning.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Placeholder areas for deposit and withdraw (wired in US-005) */}
      <div className="gap-4 md:grid-cols-2 grid">
        <div className="p-6 bg-card text-center text-muted-foreground">
          Deposit form — coming in US-005
        </div>
        <div className="p-6 bg-card text-center text-muted-foreground">
          Withdraw form — coming in US-005
        </div>
      </div>
    </div>
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
    <div className="gap-1 flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
