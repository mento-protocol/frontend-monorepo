import { Skeleton } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import { TroveRow } from "./trove-row";

interface TroveListProps {
  troves: BorrowPosition[];
  debtToken: DebtTokenConfig;
  isLoading: boolean;
}

function SkeletonRow() {
  return (
    <div className="gap-6 px-4 py-4 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] md:items-center flex flex-col rounded-lg border border-border bg-card">
      <div className="gap-2 flex items-center">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-5 w-24" />
      <div className="flex justify-end">
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}

export function TroveList({ troves, debtToken, isLoading }: TroveListProps) {
  return (
    <div className="min-h-0 flex flex-1 flex-col">
      {/* Header - hidden on mobile */}
      <div className="gap-6 px-4 py-3 md:grid hidden shrink-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,0.7fr)] rounded-lg border border-border bg-card">
        <span className="text-sm font-medium text-muted-foreground">Trove</span>
        <span className="text-sm font-medium text-muted-foreground">
          Collateral
        </span>
        <span className="text-sm font-medium text-muted-foreground">Debt</span>
        <span className="text-sm font-medium text-muted-foreground">LTV</span>
        <span className="text-sm font-medium text-muted-foreground">
          Liq. Price
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          Interest
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          Liquidation Risk
        </span>
        <span className="text-sm font-medium text-right text-muted-foreground">
          Actions
        </span>
      </div>

      {/* Rows */}
      <div className="mt-3 space-y-3 min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : troves.length === 0 ? (
          <div className="py-12 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            No active troves
          </div>
        ) : (
          troves.map((position) => (
            <TroveRow
              key={position.troveId}
              position={position}
              debtToken={debtToken}
            />
          ))
        )}
      </div>
    </div>
  );
}
