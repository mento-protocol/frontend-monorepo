"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
  Skeleton,
} from "@repo/ui";
import {
  useTroveData,
  useLoanDetails,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtAmount,
  formatInterestRate,
  formatLtv,
  formatPrice,
} from "@repo/web3";
import { Copy, Check } from "lucide-react";
import { RiskBadge } from "../shared/risk-badge";
import { AdjustForm } from "./adjust-form";
import { RateForm } from "./rate-form";
import { CloseForm } from "./close-form";
import { borrowViewAtom } from "../atoms/borrow-navigation";

const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  "at-risk": "At Risk",
  liquidatable: "Liquidatable",
  underwater: "Underwater",
};

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

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={() => setBorrowView("dashboard")}
          className="px-0"
        >
          &larr; Back to Dashboard
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Failed to load trove</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
    <div className="space-y-4">
      <Button
        variant="ghost"
        onClick={() => setBorrowView("dashboard")}
        className="px-0"
      >
        &larr; Back to Dashboard
      </Button>

      {/* Summary card — compact overview */}
      <Card className="relative">
        <div className="top-4 right-4 absolute">
          <RiskBadge risk={loanDetails?.liquidationRisk ?? null} />
        </div>
        <CardHeader className="pb-3">
          <div className="gap-1.5 flex items-center">
            <CardTitle className="shrink-0">Trove</CardTitle>
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
              className="p-0.5 rounded text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Copy trove ID"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </CardHeader>
        {troveData && (
          <CardContent>
            <div className="gap-4 sm:grid-cols-6 grid grid-cols-3">
              <Metric label="Collateral">
                {formatCollateralAmount(troveData.collateral)}
              </Metric>
              <Metric label="Debt">
                {formatDebtAmount(troveData.debt, debtToken)}
              </Metric>
              <Metric label="Interest Rate">
                {formatInterestRate(troveData.annualInterestRate)}
              </Metric>
              <Metric label="LTV">{formatLtv(loanDetails?.ltv ?? null)}</Metric>
              <Metric label="Liq. Price">
                {formatPrice(loanDetails?.liquidationPrice ?? null, debtToken)}
              </Metric>
              <Metric label="Status">
                {loanDetails?.status
                  ? (STATUS_LABELS[loanDetails.status] ?? loanDetails.status)
                  : "—"}
              </Metric>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Form card — tabs + action forms */}
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="adjust">
            <TabsList>
              <TabsTrigger value="adjust">Adjust</TabsTrigger>
              <TabsTrigger value="interest-rate">Interest Rate</TabsTrigger>
              <TabsTrigger value="close">Close</TabsTrigger>
            </TabsList>
            <TabsContent value="adjust">
              {troveData && (
                <AdjustForm troveId={troveId} troveData={troveData} />
              )}
            </TabsContent>
            <TabsContent value="interest-rate">
              {troveData && (
                <RateForm troveId={troveId} troveData={troveData} />
              )}
            </TabsContent>
            <TabsContent value="close">
              {troveData && (
                <CloseForm troveId={troveId} troveData={troveData} />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
