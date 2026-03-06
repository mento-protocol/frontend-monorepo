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
  Button,
  TokenIcon,
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
import {
  Info,
  ArrowUpDown,
  Shield,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import { formatUnits } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { useChainId } from "@repo/web3/wagmi";

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
  const chainId = useChainId();

  const { data: spPosition, isLoading: spLoading } = useStabilityPool(
    debtToken.symbol,
  );
  const { data: totalDeposits, isLoading: statsLoading } =
    useStabilityPoolStats(debtToken.symbol);

  const isLoading = spLoading || statsLoading;
  const hasDeposit = spPosition && spPosition.deposit > 0n;

  const tokenAddress = getTokenAddress(
    chainId,
    debtToken.symbol as TokenSymbol,
  );

  const hasRewards =
    spPosition &&
    ((spPosition.collateralGain != null && spPosition.collateralGain > 0n) ||
      (spPosition.debtTokenGain != null && spPosition.debtTokenGain > 0n));

  const totalRewards =
    spPosition && hasRewards
      ? (spPosition.collateralGain ?? 0n) + (spPosition.debtTokenGain ?? 0n)
      : null;

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 flex items-center justify-between bg-card">
          <div>
            <h1 className="font-medium md:text-2xl">Earn</h1>
            <p className="text-sm text-muted-foreground">
              Deposit into Stability Pools to earn liquidation and protocol
              rewards.
            </p>
          </div>
          <DebtTokenSelector />
        </div>
      </div>

      <div className="space-y-4">
        {/* Pool Selector Card */}
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="gap-3 flex items-center">
              {tokenAddress && (
                <TokenIcon
                  token={{
                    address: tokenAddress,
                    symbol: debtToken.symbol,
                  }}
                  size={40}
                  className="rounded-full"
                />
              )}
              <div>
                <span className="font-medium">
                  {debtToken.symbol} Stability Pool
                </span>
                <p className="text-sm text-muted-foreground">
                  {isLoading
                    ? "Loading..."
                    : `${formatCompactCurrency(totalDeposits ?? null, debtToken)} total deposited`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-lg font-semibold text-primary">—</span>
              <p className="text-xs text-muted-foreground">APY</p>
            </div>
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
          <Card>
            <CardContent className="py-4">
              <div className="gap-1 flex items-center">
                <span className="text-xs text-muted-foreground">
                  Total Deposits
                </span>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-lg font-semibold">
                {isLoading ? (
                  <span className="h-5 w-16 animate-pulse rounded inline-block bg-muted" />
                ) : (
                  formatCompactCurrency(totalDeposits ?? null, debtToken)
                )}
              </span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="gap-1 flex items-center">
                <span className="text-xs text-muted-foreground">
                  Liquidation Yield
                </span>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-lg font-semibold text-primary">—</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="gap-1 flex items-center">
                <span className="text-xs text-muted-foreground">
                  Protocol Yield
                </span>
                <Info className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-lg font-semibold text-primary">—</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 flex items-center justify-end">
              <ApyGauge value={null} />
            </CardContent>
          </Card>
        </div>

        {/* Two-Column Layout: Position + Deposit/Withdraw Form */}
        <div className="gap-4 md:grid-cols-2 grid grid-cols-1">
          {/* Your Position */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Your Position</h2>
                {hasDeposit && (
                  <Badge
                    variant="outline"
                    className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                  >
                    Earning
                  </Badge>
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
                <>
                  <div className="gap-x-6 gap-y-3 grid grid-cols-2">
                    <div className="gap-1 flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        Deposited
                      </span>
                      <span className="text-lg font-semibold">
                        {formatCompactCurrency(spPosition.deposit, debtToken)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTokenAmount(spPosition.deposit)}{" "}
                        {debtToken.symbol}
                      </span>
                    </div>
                    <div className="gap-1 flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        Rewards
                      </span>
                      <span className="text-lg font-semibold text-primary">
                        {formatCompactCurrency(totalRewards, debtToken)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Liq: {formatCollateralAmount(spPosition.collateralGain)}{" "}
                        Proto:{" "}
                        {formatDebtAmount(spPosition.debtTokenGain, debtToken)}
                      </span>
                    </div>
                  </div>

                  {/* Claim Rewards */}
                  <ClaimRewards
                    collateralGain={spPosition.collateralGain}
                    debtTokenGain={spPosition.debtTokenGain}
                  />
                </>
              ) : isConnected ? (
                <p className="text-sm py-6 text-center text-muted-foreground">
                  No deposit yet — deposit to start earning.
                </p>
              ) : (
                <p className="text-sm py-6 text-center text-muted-foreground">
                  Connect your wallet to view your position.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Deposit / Withdraw Form */}
          <Card>
            <CardContent className="pt-6">
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
                Deposits can be withdrawn at any time. No lock-up period.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* How the Stability Pool works */}
        <Card>
          <CardContent className="pt-6 space-y-6">
            <h2 className="text-sm font-semibold">
              How the Stability Pool works
            </h2>
            <div className="gap-6 md:grid-cols-3 grid grid-cols-1">
              <div className="gap-3 flex flex-col">
                <div className="h-10 w-10 flex items-center justify-center rounded-md bg-primary/10">
                  <ArrowUpDown className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">Deposit</h3>
                <p className="text-xs text-muted-foreground">
                  Deposit {debtToken.symbol} into the Stability Pool. Your
                  tokens are used to absorb liquidations.
                </p>
              </div>
              <div className="gap-3 flex flex-col">
                <div className="h-10 w-10 flex items-center justify-center rounded-md bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">Absorb liquidations</h3>
                <p className="text-xs text-muted-foreground">
                  When a position is liquidated, your {debtToken.symbol} is used
                  to repay debt and you receive collateral at a discount.
                </p>
              </div>
              <div className="gap-3 flex flex-col">
                <div className="h-10 w-10 flex items-center justify-center rounded-md bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">Earn rewards</h3>
                <p className="text-xs text-muted-foreground">
                  Earn liquidation gains plus additional protocol yield.
                  Withdraw anytime with no lock-up.
                </p>
              </div>
            </div>
            <a
              href="https://docs.mento.org/mento/overview/core-concepts/stability-pool"
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1 text-xs flex items-center text-primary hover:underline"
            >
              Learn more about the Stability Pool
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      </div>
      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}

function ApyGauge({ value }: { value: number | null }) {
  const radius = 36;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const progress = value != null ? Math.min(value / 20, 1) : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="relative flex items-center justify-center">
      <svg width={90} height={90} viewBox="0 0 90 90">
        <circle
          cx={45}
          cy={45}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/40"
          strokeWidth={stroke}
        />
        <circle
          cx={45}
          cy={45}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 45 45)"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold">
          {value != null ? `${value.toFixed(1)}%` : "—"}
        </span>
        <span className="text-[10px] text-muted-foreground">APY</span>
      </div>
    </div>
  );
}
