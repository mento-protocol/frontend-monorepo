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
              <div className="py-8 text-center text-muted-foreground">
                Adjust trove form — coming soon
              </div>
            </TabsContent>
            <TabsContent value="interest-rate">
              <div className="py-8 text-center text-muted-foreground">
                Interest rate change form — coming soon
              </div>
            </TabsContent>
            <TabsContent value="close">
              <div className="py-8 text-center text-muted-foreground">
                Close trove form — coming soon
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
