import { Badge, Button, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";

interface PoolRowProps {
  pool: PoolDisplay;
}

function PriceAlignmentBadge({
  status,
}: {
  status: PoolDisplay["priceAlignment"]["status"];
}) {
  switch (status) {
    case "in-band":
      return (
        <Badge className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          In band
        </Badge>
      );
    case "warning":
      return (
        <Badge className="border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400">
          Warning
        </Badge>
      );
    case "rebalance-likely":
      return (
        <Badge className="border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          Rebalance likely
        </Badge>
      );
    case "market-closed":
      return (
        <Badge className="border-border bg-muted/50 text-muted-foreground">
          Market closed
        </Badge>
      );
    default:
      return <span className="text-muted-foreground">&mdash;</span>;
  }
}

export function PoolRow({ pool }: PoolRowProps) {
  return (
    <div className="gap-4 px-4 py-4 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] items-center rounded-lg border border-border bg-card">
      {/* Pool */}
      <div className="gap-3 flex items-center">
        <div className="-space-x-2 flex">
          <TokenIcon
            token={{ address: pool.token0.address, symbol: pool.token0.symbol }}
            size={32}
            className="relative z-10 rounded-full"
          />
          <TokenIcon
            token={{ address: pool.token1.address, symbol: pool.token1.symbol }}
            size={32}
            className="rounded-full"
          />
        </div>
        <div className="gap-1 flex flex-col">
          <span className="text-sm font-medium">
            {pool.token0.symbol} / {pool.token1.symbol}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              "px-1.5 py-0 text-[10px]",
              pool.poolType === "FPMM" &&
                "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
            )}
          >
            {pool.poolType === "FPMM" ? "FPMM" : "LEGACY"}
          </Badge>
        </div>
      </div>

      {/* Reserves */}
      <div className="gap-1.5 flex flex-col">
        <div className="text-sm flex justify-between text-muted-foreground">
          <span>
            {pool.reserves.token0}{" "}
            <span className="font-medium">{pool.token0.symbol}</span>
          </span>
          <span>
            {pool.reserves.token1}{" "}
            <span className="font-medium">{pool.token1.symbol}</span>
          </span>
        </div>
        <div className="h-1.5 flex w-full overflow-hidden rounded-full">
          <div
            className="bg-primary"
            style={{ width: `${pool.reserves.token0Ratio * 100}%` }}
          />
          <div
            className="bg-primary/30"
            style={{ width: `${(1 - pool.reserves.token0Ratio) * 100}%` }}
          />
        </div>
      </div>

      {/* Fees */}
      <div className="pl-4 flex flex-col">
        <span className="text-sm font-medium">
          {pool.fees.total.toFixed(2)}%
        </span>
        {pool.fees.label === "fee" ? (
          <>
            <span className="text-xs text-muted-foreground">
              LP {pool.fees.lp.toFixed(2)}%
            </span>
            <span className="text-xs text-muted-foreground">
              Protocol {pool.fees.protocol.toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Spread</span>
        )}
      </div>

      {/* Price alignment */}
      <div>
        <PriceAlignmentBadge status={pool.priceAlignment.status} />
      </div>

      {/* Actions */}
      <div className="gap-2 flex items-center justify-end">
        {pool.poolType === "FPMM" ? (
          <>
            <Button size="sm" className="h-8">
              Deposit
            </Button>
            <Button size="sm" variant="outline" className="h-8">
              Manage
            </Button>
          </>
        ) : (
          <Button size="sm" className="h-8">
            Swap
          </Button>
        )}
      </div>
    </div>
  );
}
