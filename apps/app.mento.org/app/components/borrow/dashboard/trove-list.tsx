import { Skeleton } from "@repo/ui";
import type { BorrowPosition, DebtTokenConfig } from "@repo/web3";
import { TroveCard } from "./trove-card";

interface TroveListProps {
  troves: BorrowPosition[];
  debtToken: DebtTokenConfig;
  isLoading: boolean;
}

function SkeletonCard() {
  return (
    <div className="space-y-5 p-6 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between">
        <div className="gap-3 flex items-center">
          <Skeleton className="h-8 w-12 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <Skeleton className="h-9 w-20 rounded-lg" />
      </div>
      <div className="space-y-2 p-4 rounded-lg bg-muted/30">
        <div className="flex justify-between">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
      <div className="gap-6 grid grid-cols-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
    </div>
  );
}

export function TroveList({ troves, debtToken, isLoading }: TroveListProps) {
  return (
    <div className="gap-4 md:grid-cols-2 grid grid-cols-1">
      {isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : troves.length === 0 ? (
        <div className="py-12 col-span-full flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          No active troves
        </div>
      ) : (
        troves.map((position) => (
          <TroveCard
            key={position.troveId}
            position={position}
            debtToken={debtToken}
          />
        ))
      )}
    </div>
  );
}
