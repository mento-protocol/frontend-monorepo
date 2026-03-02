"use client";

import { useAtomValue, useSetAtom } from "jotai";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
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
import { DepositForm } from "./deposit-form";
import { WithdrawForm } from "./withdraw-form";
import { ClaimRewards } from "./claim-rewards";

export function EarnView() {
  const { isConnected } = useAccount();
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

      {/* Header: Pool info + stats row */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Stability Pool</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Deposit {debtToken.symbol} to earn rewards from liquidations and
                protocol yield.
              </p>
            </div>
            {poolShare !== null && (
              <span className="text-xs shrink-0 text-muted-foreground">
                {poolShare.toFixed(2)}% of pool
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
              <Metric label="Total Deposits">
                {formatDebtAmount(totalDeposits ?? null, debtToken)}
              </Metric>
              {hasDeposit ? (
                <>
                  <Metric label="Your Deposit">
                    {formatDebtAmount(spPosition.deposit, debtToken)}
                  </Metric>
                  <Metric label="Collateral Gain">
                    {formatCollateralAmount(spPosition.collateralGain)}
                  </Metric>
                  <Metric label={`${debtToken.symbol} Yield`}>
                    {formatDebtAmount(spPosition.debtTokenGain, debtToken)}
                  </Metric>
                </>
              ) : isConnected ? (
                <span className="md:col-span-3 text-sm col-span-1 self-center text-muted-foreground">
                  No deposit yet — deposit below to start earning.
                </span>
              ) : (
                <span className="md:col-span-3 text-sm col-span-1 self-center text-muted-foreground">
                  Connect your wallet to view your position.
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deposit / Withdraw + Claim Rewards */}
      {isConnected && (
        <Card>
          <CardContent>
            <Tabs defaultValue="deposit">
              <TabsList>
                <TabsTrigger value="deposit">Deposit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>
              <TabsContent value="deposit">
                <DepositForm
                  deposit={spPosition?.deposit ?? null}
                  collateralGain={spPosition?.collateralGain ?? null}
                  debtTokenGain={spPosition?.debtTokenGain ?? null}
                />
              </TabsContent>
              <TabsContent value="withdraw">
                <WithdrawForm
                  deposit={spPosition?.deposit ?? null}
                  collateralGain={spPosition?.collateralGain ?? null}
                  debtTokenGain={spPosition?.debtTokenGain ?? null}
                />
              </TabsContent>
            </Tabs>

            {/* Claim Rewards inline */}
            {spPosition && (
              <ClaimRewards
                collateralGain={spPosition.collateralGain}
                debtTokenGain={spPosition.debtTokenGain}
              />
            )}
          </CardContent>
        </Card>
      )}
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
