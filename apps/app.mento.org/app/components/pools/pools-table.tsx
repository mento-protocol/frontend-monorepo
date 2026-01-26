import { Skeleton } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { PoolRow } from "./pool-row";

interface PoolsTableProps {
  pools: PoolDisplay[];
  isLoading: boolean;
}

function SkeletonRow() {
  return (
    <div className="gap-4 px-4 py-4 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] items-center rounded-lg border border-border bg-card">
      <div className="gap-3 flex items-center">
        <div className="-space-x-2 flex">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="gap-1 flex flex-col">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-5 w-16" />
      <div className="gap-2 flex justify-end">
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}

export function PoolsTable({ pools, isLoading }: PoolsTableProps) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="gap-4 px-4 py-3 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] rounded-lg border border-border bg-card">
        <span className="text-sm font-medium text-muted-foreground">Pool</span>
        <span className="text-sm font-medium text-muted-foreground">
          Reserves
        </span>
        <span className="text-sm font-medium pl-4 text-muted-foreground">
          Fees
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          Price alignment
        </span>
        <span className="text-sm font-medium text-right text-muted-foreground">
          Actions
        </span>
      </div>

      {/* Rows */}
      {isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : pools.length === 0 ? (
        <div className="py-12 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          No pools found
        </div>
      ) : (
        pools.map((pool) => <PoolRow key={pool.poolAddr} pool={pool} />)
      )}
    </div>
  );
}
