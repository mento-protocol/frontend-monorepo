"use client";

import { useAtomValue } from "jotai";
import {
  Badge,
  Card,
  CardContent,
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
import { DebtTokenSelector } from "../shared/debt-token-selector";
import { DepositForm } from "./deposit-form";
import { WithdrawForm } from "./withdraw-form";
import { ClaimRewards } from "./claim-rewards";

export function EarnView() {
  const { isConnected } = useAccount();
  const debtToken = useAtomValue(selectedDebtTokenAtom);

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
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 flex items-start justify-between bg-card">
          <div>
            <h1 className="font-medium md:text-2xl">Earn</h1>
            <p className="text-sm text-muted-foreground">
              Deposit {debtToken.symbol} into the Stability Pool to earn
              liquidation and protocol rewards.
            </p>
          </div>
          <DebtTokenSelector />
        </div>
      </div>

      <div className="space-y-4">
        {/* Header: Pool info + stats row */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            {poolShare !== null && (
              <div className="flex justify-end">
                <Badge
                  variant="outline"
                  className="bg-blue-100 text-blue-800 border-blue-200"
                >
                  {poolShare.toFixed(2)}% of pool
                </Badge>
              </div>
            )}
            {isLoading ? (
              <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded bg-muted"
                  />
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
            <CardContent className="pt-6">
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
      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
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
