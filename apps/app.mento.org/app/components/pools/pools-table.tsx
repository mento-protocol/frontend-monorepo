import { Skeleton } from "@repo/ui";
import {
  getPoolRewardKey,
  type PoolDisplay,
  type PoolRewardInfo,
} from "@repo/web3";
import { PoolRow } from "./pool-row";

interface PoolsTableProps {
  pools: PoolDisplay[];
  isLoading: boolean;
  /** True when some chains have resolved but others are still loading */
  isFetchingMore?: boolean;
  isPositionsLoading?: boolean;
  onSelectPool: (pool: PoolDisplay, mode: "deposit" | "manage") => void;
  getPoolHref?: (pool: PoolDisplay) => string;
  positionBalancesByPool?: Map<string, bigint>;
  rewards?: Map<string, PoolRewardInfo>;
}

function SkeletonRow() {
  return (
    <div className="gap-4 md:gap-4 px-4 py-4 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] md:items-center flex flex-col rounded-lg border border-border bg-card">
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
      <Skeleton className="h-4 w-16 md:ml-4" />
      <Skeleton className="h-4 w-16" />
      <div className="gap-2 md:justify-end flex">
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  );
}

export function PoolsTable({
  pools,
  isLoading,
  isFetchingMore,
  isPositionsLoading,
  onSelectPool,
  getPoolHref,
  positionBalancesByPool,
  rewards,
}: PoolsTableProps) {
  return (
    <div className="min-h-0 flex flex-1 flex-col">
      {/* Header - hidden on mobile */}
      <div className="gap-4 px-4 py-3 md:grid hidden shrink-0 grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] rounded-lg border border-border bg-card">
        <span className="text-sm font-medium text-muted-foreground">Pool</span>
        <span className="text-sm font-medium text-muted-foreground">
          Reserves
        </span>
        <span className="pl-4 text-sm font-medium text-muted-foreground">
          Fee
        </span>
        <span className="text-sm font-medium text-muted-foreground">TVL</span>
        <span className="text-sm font-medium text-right text-muted-foreground">
          Actions
        </span>
      </div>

      {/* Scrollable rows */}
      <div className="mt-3 space-y-3 min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : pools.length === 0 && !isFetchingMore ? (
          <div className="py-12 flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            No pools found
          </div>
        ) : (
          <>
            {pools.map((pool) => (
              <PoolRow
                key={`${pool.chainId}-${pool.poolAddr}`}
                pool={pool}
                hasLPTokens={
                  (positionBalancesByPool?.get(
                    `${pool.chainId}:${pool.poolAddr.toLowerCase()}`,
                  ) ?? 0n) > 0n
                }
                isLpBalanceLoading={!!isPositionsLoading}
                onSelect={onSelectPool}
                poolHref={getPoolHref?.(pool)}
                rewards={rewards?.get(
                  getPoolRewardKey(pool.chainId, pool.poolAddr),
                )}
              />
            ))}
            {isFetchingMore && <SkeletonRow />}
          </>
        )}
      </div>
    </div>
  );
}
