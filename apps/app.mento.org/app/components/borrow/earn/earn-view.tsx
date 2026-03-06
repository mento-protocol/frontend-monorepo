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
  useStabilityPoolApy,
  useStabilityPoolStats,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { DebtTokenSelector } from "../shared/debt-token-selector";
import { DepositForm } from "./deposit-form";
import { WithdrawForm } from "./withdraw-form";
import { ClaimRewards } from "./claim-rewards";
import { Plus, TrendingUp, Clock, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";

function formatCompactCurrency(
  amount: bigint | null | undefined,
  debtToken: { currencySymbol: string },
): string {
  if (amount == null) return "—";
  const num = Number(formatUnits(amount, 18));
  if (num >= 1_000_000) {
    return `${debtToken.currencySymbol}${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${debtToken.currencySymbol}${(num / 1_000).toFixed(1)}K`;
  }
  return `${debtToken.currencySymbol}${num.toFixed(2)}`;
}

function formatTokenAmount(amount: bigint | null | undefined): string {
  if (amount == null) return "—";
  const num = Number(formatUnits(amount, 18));
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

export function EarnView() {
  const { isConnected } = useAccount();
  const debtToken = useAtomValue(selectedDebtTokenAtom);

  const { data: spPosition, isLoading: spLoading } = useStabilityPool(
    debtToken.symbol,
  );
  const { data: totalDeposits, isLoading: statsLoading } =
    useStabilityPoolStats(debtToken.symbol);
  const {
    data: spApy,
    avgInterestRate,
    isLoading: apyLoading,
  } = useStabilityPoolApy(debtToken.symbol);

  const isLoading = spLoading || statsLoading;
  const apyDisplay = spApy != null ? `${(spApy * 100).toFixed(1)}` : "—";
  const avgRateDisplay =
    avgInterestRate != null ? `${(avgInterestRate * 100).toFixed(1)}` : "—";
  const hasDeposit = spPosition && spPosition.deposit > 0n;

  const poolShare =
    hasDeposit && totalDeposits && totalDeposits > 0n
      ? Number((spPosition.deposit * 10000n) / totalDeposits) / 100
      : null;

  const hasRewards =
    spPosition &&
    ((spPosition.collateralGain != null && spPosition.collateralGain > 0n) ||
      (spPosition.debtTokenGain != null && spPosition.debtTokenGain > 0n));

  const totalRewards =
    spPosition && hasRewards
      ? (spPosition.collateralGain ?? 0n) + (spPosition.debtTokenGain ?? 0n)
      : null;

  const steps = [
    {
      icon: <Plus className="h-5 w-5" />,
      title: "Deposit",
      desc: `Add ${debtToken.symbol} to the pool. No lock-up, withdraw anytime.`,
    },
    {
      icon: <TrendingUp className="h-5 w-5" />,
      title: "Absorb liquidations",
      desc: `Your ${debtToken.symbol} repays debt and you receive collateral at a discount.`,
    },
    {
      icon: <Clock className="h-5 w-5" />,
      title: "Earn rewards",
      desc: "Liquidation gains plus protocol yield plus trove interest. Compounding optional.",
    },
  ];

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 flex items-center justify-between bg-card">
          <div>
            <h1 className="font-bold text-3xl">Earn</h1>
            <p className="text-sm text-muted-foreground">
              Deposit into the Stability Pool to earn liquidation gains and
              protocol rewards. No lock-up period.
            </p>
          </div>
          <DebtTokenSelector />
        </div>
      </div>

      <div className="space-y-6">
        {/* Stats Row */}
        <div className="gap-4 grid grid-cols-3">
          <Card className="!py-0 !gap-0">
            <CardContent className="!px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                Total Deposits
              </span>
              <div className="text-xl font-bold">
                {isLoading ? (
                  <span className="h-6 w-16 animate-pulse rounded inline-block bg-muted" />
                ) : (
                  formatCompactCurrency(totalDeposits ?? null, debtToken)
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="!py-0 !gap-0">
            <CardContent className="!px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                Pool APY
              </span>
              <div className="text-xl font-bold text-primary">
                {apyLoading ? (
                  <span className="h-6 w-12 animate-pulse rounded inline-block bg-muted" />
                ) : (
                  <>
                    {apyDisplay}
                    <span className="text-sm ml-0.5 text-primary/60">%</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="!py-0 !gap-0">
            <CardContent className="!px-4 py-3">
              <span className="text-sm font-semibold text-muted-foreground">
                Avg. Borrow Rate
              </span>
              <div className="text-xl font-bold">
                {apyLoading ? (
                  <span className="h-6 w-12 animate-pulse rounded inline-block bg-muted" />
                ) : (
                  <>
                    {avgRateDisplay}
                    <span className="text-sm ml-0.5 text-muted-foreground">
                      %
                    </span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Two-Column Layout: Position + Deposit/Withdraw Form */}
        <div className="gap-6 md:grid-cols-2 grid grid-cols-1">
          {/* Your Position */}
          <Card className="!py-0 !gap-0">
            <CardContent className="!px-4 pt-5 pb-4 flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Your Position
                  </span>
                  {hasDeposit && (
                    <div className="gap-2 flex items-center">
                      {poolShare != null && (
                        <Badge variant="outline" className="text-[11px]">
                          {poolShare.toFixed(2)}% of pool
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 tracking-wide text-[11px] uppercase"
                      >
                        Earning
                      </Badge>
                    </div>
                  )}
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded bg-muted"
                      />
                    ))}
                  </div>
                ) : hasDeposit ? (
                  <div className="gap-10 mb-6 flex">
                    <div className="gap-1 flex flex-col">
                      <span className="font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
                        Deposited
                      </span>
                      <span className="text-2xl font-bold tracking-tight">
                        {formatCompactCurrency(spPosition.deposit, debtToken)}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatTokenAmount(spPosition.deposit)}{" "}
                        {debtToken.symbol}
                      </span>
                    </div>
                    <div className="gap-1 flex flex-col">
                      <span className="font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
                        Rewards
                      </span>
                      <span className="text-2xl font-bold tracking-tight text-primary">
                        {formatCompactCurrency(totalRewards, debtToken)}
                      </span>
                      <span className="text-xs text-primary/50">Claimable</span>
                    </div>
                  </div>
                ) : isConnected ? (
                  <p className="text-sm py-8 text-center text-muted-foreground">
                    No deposit yet — deposit to start earning.
                  </p>
                ) : (
                  <p className="text-sm py-8 text-center text-muted-foreground">
                    Connect your wallet to view your position.
                  </p>
                )}
              </div>

              {/* Claim Rewards */}
              {hasDeposit && (
                <ClaimRewards
                  collateralGain={spPosition.collateralGain}
                  debtTokenGain={spPosition.debtTokenGain}
                />
              )}
            </CardContent>
          </Card>

          {/* Deposit / Withdraw Form */}
          <Card className="!py-0 !gap-0">
            <CardContent className="!px-4 pt-4 pb-4">
              {isConnected ? (
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
              ) : (
                <div className="py-8 text-center">
                  <p className="text-sm mb-4 text-muted-foreground">
                    Connect your wallet to deposit or withdraw.
                  </p>
                </div>
              )}
              <p className="text-xs mt-4 text-center text-muted-foreground">
                No lock-up period &middot; Withdraw anytime
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How it works */}
        <div>
          <h3 className="font-semibold tracking-widest mb-4 text-[11px] text-muted-foreground uppercase">
            How it works
          </h3>
          <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
            {steps.map((step, i) => (
              <Card
                key={i}
                className="!py-0 !gap-0 transition-colors hover:bg-accent/50"
              >
                <CardContent className="!px-4 py-3">
                  <div className="gap-2 mb-1 flex items-center">
                    <div className="h-7 w-7 flex items-center justify-center rounded-md bg-primary/10 text-primary">
                      {step.icon}
                    </div>
                    <span className="text-sm font-semibold">{step.title}</span>
                    <span className="font-semibold ml-auto text-[11px] text-muted-foreground/50">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {step.desc}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Footer link */}
        <div className="pt-4 border-t border-border text-center">
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/stability-pool"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1.5 text-xs inline-flex items-center text-primary hover:underline"
          >
            Learn more about the Stability Pool
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}
