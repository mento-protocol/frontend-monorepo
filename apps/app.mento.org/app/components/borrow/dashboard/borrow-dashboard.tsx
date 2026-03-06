"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Button, Card, CardContent, Skeleton } from "@repo/ui";
import {
  useUserTroves,
  useSurplusCollateral,
  useClaimCollateral,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
} from "@repo/web3";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { useLoanDetails } from "@repo/web3";
import { TroveList } from "./trove-list";
import { borrowViewAtom } from "../atoms/borrow-navigation";
import { activeTabAtom } from "@/atoms/navigation";
import { Plus } from "lucide-react";

export function BorrowDashboard() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

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
    return (
      <EmptyState
        onOpenTrove={() => setBorrowView("open-trove")}
        onEarn={() => setActiveTab("earn")}
      />
    );
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

function EmptyState({
  onOpenTrove,
  onEarn,
}: {
  onOpenTrove: () => void;
  onEarn: () => void;
}) {
  return (
    <div className="p-8 space-y-4 bg-card text-center">
      <p className="text-muted-foreground">
        You don&apos;t have any active positions yet.
      </p>
      <div className="gap-3 flex justify-center">
        <Button onClick={onOpenTrove}>Open Your First Trove</Button>
        <Button variant="outline" onClick={onEarn}>
          Deposit into Stability Pool
        </Button>
      </div>
    </div>
  );
}
