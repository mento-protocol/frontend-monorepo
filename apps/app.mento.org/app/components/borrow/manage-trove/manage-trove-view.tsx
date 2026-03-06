"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Card,
  CardContent,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Skeleton,
  TokenIcon,
} from "@repo/ui";
import type { RiskLevel } from "@repo/web3";
import {
  useTroveData,
  useLoanDetails,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtAmount,
  formatInterestRate,
  formatPrice,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { ChevronLeft, Copy, Check } from "lucide-react";
import { AdjustForm } from "./adjust-form";
import { RateForm } from "./rate-form";
import { CloseForm } from "./close-form";
import { borrowViewAtom } from "../atoms/borrow-navigation";

const COLLATERAL_SYMBOL = "USDm";

const STATUS_LABELS: Record<string, { label: string; colorClass: string }> = {
  healthy: { label: "Active", colorClass: "text-green-500" },
  "at-risk": { label: "At Risk", colorClass: "text-amber-400" },
  liquidatable: { label: "Liquidatable", colorClass: "text-red-500" },
  underwater: { label: "Underwater", colorClass: "text-red-500" },
};

const RISK_STYLES: Record<
  RiskLevel,
  { label: string; textClass: string; bgClass: string; barColor: string }
> = {
  low: {
    label: "Healthy",
    textClass: "text-green-500",
    bgClass: "bg-green-500/10 text-green-500",
    barColor: "bg-green-500",
  },
  medium: {
    label: "Moderate",
    textClass: "text-amber-400",
    bgClass: "bg-amber-400/10 text-amber-400",
    barColor: "bg-amber-400",
  },
  high: {
    label: "At Risk",
    textClass: "text-red-500",
    bgClass: "bg-red-500/10 text-red-500",
    barColor: "bg-red-500",
  },
};

function getLtvPercent(ltv: bigint | null | undefined): number | null {
  if (ltv == null) return null;
  const divisor = 10n ** 18n;
  return Number((ltv * 10000n) / divisor) / 100;
}

function LtvHealthBar({
  ltv,
  risk,
  maxLtv,
}: {
  ltv: bigint | null | undefined;
  risk: RiskLevel | null;
  maxLtv: bigint;
}) {
  const ltvPct = getLtvPercent(ltv);
  const maxLtvPct = getLtvPercent(maxLtv);
  const riskStyle = risk ? RISK_STYLES[risk] : RISK_STYLES.low;

  if (ltvPct == null || maxLtvPct == null) return null;

  const fillWidth = Math.min((ltvPct / maxLtvPct) * 100, 100);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="gap-2 flex items-baseline">
          <span
            className={`text-2xl font-bold tracking-tight ${riskStyle.textClass}`}
          >
            {ltvPct.toFixed(1)}%
          </span>
          <span
            className={`px-2 py-0.5 rounded font-semibold tracking-wider font-mono text-[11px] uppercase ${riskStyle.bgClass}`}
          >
            {riskStyle.label}
          </span>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground/50">
          Liquidation at {maxLtvPct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 relative w-full overflow-hidden rounded-full bg-muted/50">
        <div
          className={`inset-y-0 left-0 absolute rounded-full transition-all duration-500 ${riskStyle.barColor}`}
          style={{ width: `${fillWidth}%` }}
        />
      </div>
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

interface ManageTroveViewProps {
  troveId: string;
}

export function ManageTroveView({ troveId }: ManageTroveViewProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);
  const chainId = useChainId();
  const [copied, setCopied] = useState(false);

  const {
    data: troveData,
    isLoading,
    isError,
    error,
  } = useTroveData(troveId, debtToken.symbol);

  const loanDetails = useLoanDetails(
    troveData?.collateral ?? null,
    troveData?.debt ?? null,
    troveData?.annualInterestRate ?? null,
    debtToken.symbol,
  );

  const collateralAddress = getTokenAddress(
    chainId,
    COLLATERAL_SYMBOL as TokenSymbol,
  ) as Address | undefined;

  const debtTokenAddress = getTokenAddress(
    chainId,
    debtToken.symbol as TokenSymbol,
  ) as Address | undefined;

  const statusConfig = loanDetails?.status
    ? (STATUS_LABELS[loanDetails.status] ?? {
        label: loanDetails.status,
        colorClass: "text-muted-foreground",
      })
    : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-36" />
        <div className="gap-4 flex items-center">
          <Skeleton className="h-10 w-12 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setBorrowView("dashboard")}
          className="gap-1 text-sm flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
        <Card>
          <CardContent className="pt-6 space-y-2">
            <p className="font-semibold">Failed to load trove</p>
            <p className="text-sm text-destructive">
              Could not fetch data for trove #{troveId}.
            </p>
            {error instanceof Error && (
              <p className="text-xs break-all text-muted-foreground">
                {error.message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <button
        type="button"
        onClick={() => setBorrowView("dashboard")}
        className="gap-1 text-sm flex items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Dashboard
      </button>

      {/* Trove header */}
      <div className="gap-4 px-6 py-5 flex flex-wrap items-center justify-between rounded-xl border border-border bg-card">
        <div className="gap-3 flex items-center">
          {/* Token pair icons */}
          <div className="h-10 w-12 relative">
            {collateralAddress && (
              <TokenIcon
                token={{
                  address: collateralAddress,
                  symbol: COLLATERAL_SYMBOL,
                }}
                size={36}
                className="left-0 top-0 absolute z-10 rounded-full ring-2 ring-background"
              />
            )}
            {debtTokenAddress && (
              <TokenIcon
                token={{
                  address: debtTokenAddress,
                  symbol: debtToken.symbol,
                }}
                size={36}
                className="top-0 left-5 absolute rounded-full ring-2 ring-background"
              />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {COLLATERAL_SYMBOL} / {debtToken.symbol}
            </h1>
            <div className="mt-0.5 gap-2 flex items-center">
              <span className="text-xs font-mono text-muted-foreground">
                {shortenId(troveId)}
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(troveId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-0 text-muted-foreground/50 transition-colors hover:text-foreground"
                aria-label="Copy trove ID"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Status + Trove # */}
        <div className="gap-1.5 text-xs font-mono flex items-center text-muted-foreground">
          {statusConfig && (
            <>
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusConfig.colorClass === "text-green-500" ? "bg-green-500" : statusConfig.colorClass === "text-amber-400" ? "bg-amber-400" : "bg-red-500"}`}
              />
              <span className={statusConfig.colorClass}>
                {statusConfig.label}
              </span>
              <span className="mx-0.5 opacity-30">&middot;</span>
            </>
          )}
          Trove #{troveId.slice(2, 6)}
        </div>
      </div>

      {/* LTV Health Bar */}
      {loanDetails && (
        <Card className="!py-0 !gap-0">
          <CardContent className="!px-6 py-5">
            <span className="font-medium tracking-widest font-mono mb-3 block text-[11px] text-muted-foreground uppercase">
              Loan-to-Value
            </span>
            <LtvHealthBar
              ltv={loanDetails.ltv}
              risk={loanDetails.liquidationRisk}
              maxLtv={loanDetails.maxLtv}
            />
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      {troveData && (
        <div className="gap-4 md:grid-cols-4 grid grid-cols-2">
          <StatCell
            label="Collateral"
            value={formatCollateralAmount(troveData.collateral)}
          />
          <StatCell
            label="Debt"
            value={formatDebtAmount(troveData.debt, debtToken)}
          />
          <StatCell
            label="Interest Rate"
            value={formatInterestRate(troveData.annualInterestRate)}
          />
          <StatCell
            label="Liq. Price"
            value={formatPrice(
              loanDetails?.liquidationPrice ?? null,
              debtToken,
            )}
          />
        </div>
      )}

      {/* Action panel with tabs */}
      <Card className="!py-0 !gap-0">
        <CardContent className="!p-0">
          <Tabs defaultValue="adjust">
            <TabsList className="p-0 w-full justify-start rounded-none border-b border-border bg-transparent">
              <TabsTrigger
                value="adjust"
                className="px-0 py-4 flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Adjust Position
              </TabsTrigger>
              <TabsTrigger
                value="interest-rate"
                className="px-0 py-4 flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Interest Rate
              </TabsTrigger>
              <TabsTrigger
                value="close"
                className="px-0 py-4 flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Close Trove
              </TabsTrigger>
            </TabsList>
            <div className="p-6">
              <TabsContent value="adjust" className="mt-0">
                {troveData && (
                  <AdjustForm troveId={troveId} troveData={troveData} />
                )}
              </TabsContent>
              <TabsContent value="interest-rate" className="mt-0">
                {troveData && (
                  <RateForm troveId={troveId} troveData={troveData} />
                )}
              </TabsContent>
              <TabsContent value="close" className="mt-0">
                {troveData && (
                  <CloseForm troveId={troveId} troveData={troveData} />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <Card className="!py-0 !gap-0">
      <CardContent className="!px-4 py-4">
        <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
          {label}
        </span>
        <div className="mt-1 font-semibold tracking-tight">{value}</div>
      </CardContent>
    </Card>
  );
}
