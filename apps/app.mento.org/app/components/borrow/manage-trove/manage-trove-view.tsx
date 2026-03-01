"use client";

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
} from "@repo/web3";
import { TroveMetrics } from "../shared/trove-metrics";
import { AdjustForm } from "./adjust-form";
import { RateForm } from "./rate-form";
import { CloseForm } from "./close-form";
import { borrowViewAtom } from "../atoms/borrow-navigation";

interface ManageTroveViewProps {
  troveId: string;
}

export function ManageTroveView({ troveId }: ManageTroveViewProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);
  const { data: troveData, isLoading } = useTroveData(
    troveId,
    debtToken.symbol,
  );

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
          <CardTitle>Trove #{troveId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current trove summary */}
          {troveData && (
            <div className="space-y-4">
              <div className="gap-4 sm:grid-cols-3 grid grid-cols-2">
                <div className="gap-1 flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    Collateral
                  </span>
                  <span className="text-sm font-medium">
                    {formatCollateralAmount(troveData.collateral)}
                  </span>
                </div>
                <div className="gap-1 flex flex-col">
                  <span className="text-xs text-muted-foreground">Debt</span>
                  <span className="text-sm font-medium">
                    {formatDebtAmount(troveData.debt, debtToken)}
                  </span>
                </div>
                <div className="gap-1 flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    Interest Rate
                  </span>
                  <span className="text-sm font-medium">
                    {formatInterestRate(troveData.annualInterestRate)}
                  </span>
                </div>
              </div>
              <TroveMetrics loanDetails={loanDetails} debtToken={debtToken} />
            </div>
          )}

          {/* Tab navigation */}
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
