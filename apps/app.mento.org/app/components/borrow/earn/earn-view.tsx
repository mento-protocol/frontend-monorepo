"use client";

import { useAtomValue } from "jotai";
import {
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
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { TokenIcon } from "@repo/ui";
import { DebtTokenSelector } from "../shared/debt-token-selector";
import {
  UnsupportedChainState,
  isBorrowSupportedChain,
} from "../shared/unsupported-chain-state";
import { FlowDialog } from "../shared/flow-dialog";
import { DepositForm } from "./deposit-form";
import { WithdrawForm } from "./withdraw-form";
import { ClaimRewards } from "./claim-rewards";
import { Plus, TrendingUp, Clock, ExternalLink } from "lucide-react";
import { formatUnits } from "viem";

function formatCompactCurrency(
  amount: bigint | null | undefined,
  debtToken: { symbol: string },
): string {
  if (amount == null) return "—";
  const num = Number(formatUnits(amount, 18));
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M ${debtToken.symbol}`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K ${debtToken.symbol}`;
  }
  return `${num.toFixed(2)} ${debtToken.symbol}`;
}

export function EarnView() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const isSupported = isBorrowSupportedChain(chainId);

  const debtTokenAddress = (() => {
    try {
      return getTokenAddress(
        chainId,
        debtToken.symbol as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  const collateralTokenAddress = (() => {
    try {
      return getTokenAddress(chainId, "USDm" as TokenSymbol) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

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
            <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
              Stability Pool
            </span>
            <h1 className="mt-2 font-bold text-3xl">Earn</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Deposit into the Stability Pool to earn liquidation gains and
              protocol rewards. No lock-up period.
            </p>
          </div>
          {isSupported && <DebtTokenSelector />}
        </div>
      </div>

      {!isSupported ? (
        <UnsupportedChainState feature="earn" />
      ) : (
        <div className="space-y-6">
          {/* Stats Row */}
          <div className="gap-4 grid grid-cols-3">
            <Card className="!py-0 !gap-0">
              <CardContent className="!px-4 py-3">
                <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
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
                <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
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
                <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
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
            <div className="p-6 flex flex-col justify-between rounded-xl border border-border bg-card">
              <div>
                {/* Header */}
                <div className="mb-5 gap-6 grid grid-cols-2">
                  <div className="gap-2.5 flex items-center">
                    <span className="text-sm font-semibold text-muted-foreground">
                      Your Position
                    </span>
                    {hasDeposit && (
                      <span className="h-1.5 w-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                    )}
                  </div>
                  <div>
                    {hasDeposit && poolShare != null && (
                      <span className="px-2.5 py-1 font-semibold font-mono tracking-wider bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-[11px]">
                        {poolShare.toFixed(2)}% POOL SHARE
                      </span>
                    )}
                  </div>
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
                  <div className="gap-6 mb-6 grid grid-cols-2">
                    {/* Deposited */}
                    <div>
                      <div className="font-mono tracking-widest mb-3 text-[11px] text-muted-foreground uppercase">
                        Deposited
                      </div>
                      <div className="gap-3 flex items-center">
                        {debtTokenAddress && (
                          <TokenIcon
                            token={{
                              address: debtTokenAddress,
                              symbol: debtToken.symbol,
                            }}
                            size={28}
                            className="shrink-0 rounded-full"
                          />
                        )}
                        <div>
                          <div className="text-lg font-bold tracking-tight tabular-nums">
                            {formatCompactCurrency(
                              spPosition.deposit,
                              debtToken,
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Rewards */}
                    <div>
                      <div className="font-mono tracking-widest mb-3 text-[11px] text-muted-foreground uppercase">
                        Claimable Rewards
                      </div>
                      <div className="space-y-2.5">
                        {spPosition.debtTokenGain != null &&
                          spPosition.debtTokenGain > 0n && (
                            <div className="gap-3 flex items-center">
                              {debtTokenAddress && (
                                <TokenIcon
                                  token={{
                                    address: debtTokenAddress,
                                    symbol: debtToken.symbol,
                                  }}
                                  size={28}
                                  className="shrink-0 rounded-full"
                                />
                              )}
                              <div>
                                <div className="text-lg font-bold tracking-tight tabular-nums">
                                  {formatCompactCurrency(
                                    spPosition.debtTokenGain,
                                    debtToken,
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        {spPosition.collateralGain != null &&
                          spPosition.collateralGain > 0n && (
                            <div className="gap-3 flex items-center">
                              {collateralTokenAddress && (
                                <TokenIcon
                                  token={{
                                    address: collateralTokenAddress,
                                    symbol: "USDm",
                                  }}
                                  size={28}
                                  className="shrink-0 rounded-full"
                                />
                              )}
                              <div>
                                <div className="text-lg font-bold tracking-tight tabular-nums">
                                  {formatCompactCurrency(
                                    spPosition.collateralGain,
                                    { symbol: "USDm" },
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ) : isConnected ? (
                  <div className="py-8 flex flex-col items-center text-center">
                    <div className="mb-5 flex justify-center">
                      {debtTokenAddress ? (
                        <TokenIcon
                          token={{
                            address: debtTokenAddress,
                            symbol: debtToken.symbol,
                          }}
                          size={44}
                          className="rounded-full"
                        />
                      ) : (
                        <div className="h-11 w-11 text-lg font-bold flex items-center justify-center rounded-full bg-primary/10 text-primary">
                          {debtToken.symbol.charAt(0)}
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      No deposit yet — deposit to start earning.
                    </p>
                  </div>
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
            </div>

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
            <h3 className="mb-4 font-mono font-semibold tracking-widest text-[11px] text-muted-foreground uppercase">
              How it works
            </h3>
            <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
              {steps.map((step, i) => (
                <Card
                  key={i}
                  className="!py-0 !gap-0 transition-colors hover:bg-accent/50"
                >
                  <CardContent className="p-6">
                    <div className="mb-3.5 gap-3 flex items-center">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {step.icon}
                      </div>
                      <span className="font-mono font-semibold text-[11px] text-muted-foreground/25">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h4 className="mb-1.5 font-semibold text-[15px]">
                      {step.title}
                    </h4>
                    <p className="leading-relaxed text-[13px] text-muted-foreground/60">
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
              href="https://docs.mento.org/mento-v3/dive-deeper/cdp"
              target="_blank"
              rel="noopener noreferrer"
              className="gap-1.5 text-xs inline-flex items-center text-primary hover:underline"
            >
              Learn more about the Stability Pool
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
      <FlowDialog />
    </div>
  );
}
