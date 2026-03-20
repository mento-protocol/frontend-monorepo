"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Button, Card, CardContent, Skeleton, TokenIcon } from "@repo/ui";
import {
  useUserTroves,
  useSurplusCollateral,
  useClaimCollateral,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
  useLoanDetails,
} from "@repo/web3";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import { useAccount, useConfig, useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { Plus, Wallet, Clock, Settings, ArrowUpRight } from "lucide-react";
import { TroveList } from "./trove-list";
import { borrowViewAtom } from "../atoms/borrow-navigation";

export function BorrowDashboard() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);

  const {
    data: troves,
    isLoading: trovesLoading,
    isError: trovesError,
    error: trovesErrorDetail,
  } = useUserTroves(debtToken.symbol);

  const { data: surplusAmount } = useSurplusCollateral(debtToken.symbol);
  const claimCollateral = useClaimCollateral();

  const hasTroves = troves && troves.length > 0;
  const hasSurplus = surplusAmount != null && surplusAmount > 0n;

  if (!isConnected) {
    return <NotConnectedState />;
  }

  if (trovesError) {
    return (
      <div className="p-6 bg-card text-center">
        <p className="text-destructive">
          Failed to load positions. Please check your connection and try again.
        </p>
        {trovesErrorDetail instanceof Error && (
          <p className="mt-2 text-xs break-all text-muted-foreground">
            {trovesErrorDetail.message}
          </p>
        )}
      </div>
    );
  }

  if (!trovesLoading && !hasTroves && !hasSurplus) {
    return <EmptyState onOpenTrove={() => setBorrowView("open-trove")} />;
  }

  return (
    <div className="space-y-6">
      {/* Claim collateral banner */}
      {hasSurplus && (
        <div className="p-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5">
          <div>
            <p className="font-medium">Surplus Collateral Available</p>
            <p className="text-sm text-muted-foreground">
              You have {formatCollateralAmount(surplusAmount)} available to
              claim from a liquidated position.
            </p>
          </div>
          <Button
            onClick={() =>
              claimCollateral.mutate({
                symbol: debtToken.symbol,
                wagmiConfig,
                account: address!,
              })
            }
            disabled={claimCollateral.isPending}
          >
            {claimCollateral.isPending ? "Claiming…" : "Claim Collateral"}
          </Button>
        </div>
      )}

      {/* Portfolio Summary */}
      <PortfolioSummary
        troves={troves ?? []}
        debtToken={debtToken}
        isLoading={trovesLoading}
      />

      {/* Open Trove CTA */}
      <Button onClick={() => setBorrowView("open-trove")} className="gap-2">
        <Plus className="h-4 w-4" />
        Open New Trove
      </Button>

      {/* Your Troves section */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
          Your Troves
        </h3>
        {hasTroves && (
          <span className="text-xs font-mono text-muted-foreground/50">
            {troves.length} position{troves.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Trove list */}
      <TroveList
        troves={troves ?? []}
        debtToken={debtToken}
        isLoading={trovesLoading}
      />
    </div>
  );
}

function PortfolioSummary({
  troves,
  debtToken,
  isLoading,
}: {
  troves: BorrowPosition[];
  debtToken: DebtTokenConfig;
  isLoading: boolean;
}) {
  const totalCollateral =
    troves.length > 0
      ? troves.reduce((sum, t) => sum + t.collateral, 0n)
      : null;
  const totalDebt =
    troves.length > 0 ? troves.reduce((sum, t) => sum + t.debt, 0n) : null;

  // Compute weighted average LTV from the first trove's loan details context
  // We use the total collateral/debt to get an aggregate LTV
  const avgLoanDetails = useLoanDetails(
    totalCollateral,
    totalDebt,
    troves[0]?.annualInterestRate ?? null,
    debtToken.symbol,
  );

  const stats = [
    {
      label: "Total Collateral",
      value: isLoading ? null : formatCollateralAmount(totalCollateral),
    },
    {
      label: "Total Debt",
      value: isLoading ? null : formatDebtAmount(totalDebt, debtToken),
    },
    {
      label: "Avg LTV",
      value: isLoading ? null : formatLtv(avgLoanDetails?.ltv ?? null),
      accent: true,
    },
    {
      label: "Open Troves",
      value: isLoading ? null : troves.length.toString(),
    },
  ];

  return (
    <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
      {stats.map((stat) => (
        <Card key={stat.label} className="!py-0 !gap-0">
          <CardContent className="!px-4 py-4">
            <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
              {stat.label}
            </span>
            <div
              className={`mt-1 text-xl font-semibold tracking-tight ${stat.accent ? "text-primary" : ""}`}
            >
              {stat.value != null ? (
                stat.value
              ) : (
                <Skeleton className="mt-1 h-6 w-20" />
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function NotConnectedState() {
  return (
    <div className="p-8 bg-card text-center">
      <p className="text-muted-foreground">
        Connect your wallet to view your borrow positions.
      </p>
    </div>
  );
}

function EmptyState({ onOpenTrove }: { onOpenTrove: () => void }) {
  const chainId = useChainId();
  const debtToken = useAtomValue(selectedDebtTokenAtom);

  const collateralAddress = (() => {
    try {
      return getTokenAddress(chainId, "USDm" as TokenSymbol) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

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

  const stats = [
    { label: "Min. collateral ratio", value: "110%" },
    { label: "Min. debt", value: `${debtToken.currencySymbol}1,000` },
    { label: "Interest rates from", value: "0.5%" },
  ];

  const steps = [
    {
      icon: <Wallet className="h-5 w-5" />,
      title: "Deposit collateral",
      desc: "Lock USDm as collateral to secure your loan. The more you deposit, the more you can borrow.",
    },
    {
      icon: <Clock className="h-5 w-5" />,
      title: `Borrow ${debtToken.symbol}`,
      desc: `Mint ${debtToken.symbol} stablecoins against your collateral at your chosen interest rate. No fixed repayment schedule.`,
    },
    {
      icon: <Settings className="h-5 w-5" />,
      title: "Manage anytime",
      desc: "Add or remove collateral, repay debt, or adjust your interest rate. Close your position whenever you want.",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Empty state card */}
      <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
        {/* Top accent line */}
        <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        {/* Token icon cluster */}
        <div className="mb-7 flex justify-center">
          <div className="h-14 w-20 relative">
            <div className="left-0 top-2 absolute z-[2]">
              {collateralAddress ? (
                <TokenIcon
                  token={{ address: collateralAddress, symbol: "USDm" }}
                  size={44}
                  className="rounded-full"
                />
              ) : (
                <div className="h-11 w-11 bg-emerald-500 text-lg font-bold flex items-center justify-center rounded-full">
                  $
                </div>
              )}
            </div>
            <div className="left-8 top-2 absolute z-[1]">
              <div className="rounded-full border-[3px] border-card">
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
                  <div className="h-11 w-11 bg-indigo-500 text-lg font-bold flex items-center justify-center rounded-full">
                    {debtToken.currencySymbol}
                  </div>
                )}
              </div>
            </div>
            {/* Arrow badge */}
            <div className="left-6 top-0 absolute z-[3] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-border bg-card">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                className="text-primary"
              >
                <path
                  d="M3 5h4M5.5 3L7 5l-1.5 2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>

        <h2 className="mb-2.5 text-xl font-bold tracking-tight">
          No open positions yet
        </h2>
        <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
          Open a Trove to deposit USDm collateral and borrow {debtToken.symbol}.
          You set your own interest rate and there&apos;s no fixed repayment
          schedule.
        </p>

        {/* CTA */}
        <Button onClick={onOpenTrove} size="lg" className="gap-2.5">
          <Plus className="h-4 w-4" />
          Open Your First Trove
        </Button>

        {/* Stats */}
        <div className="mt-9 gap-8 pt-7 flex justify-center border-t border-border/40">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-lg font-bold tracking-tight">{s.value}</div>
              <div className="font-mono tracking-wide text-[11px] text-muted-foreground/50">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* How borrowing works */}
      <div>
        <h3 className="mb-4 font-mono font-semibold tracking-widest text-[11px] text-muted-foreground uppercase">
          How borrowing works
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
      <div className="pt-6 border-t border-border/40 text-center">
        <a
          href="https://docs.mento.org"
          target="_blank"
          rel="noopener noreferrer"
          className="gap-1.5 font-medium inline-flex items-center text-[13px] text-primary hover:underline"
        >
          Learn more about Troves and liquidation
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
