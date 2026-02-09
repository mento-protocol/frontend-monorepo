import { Badge, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";

interface LiquidityDrawerHeaderProps {
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
        <Badge className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400 flex items-center justify-center">
          In band
        </Badge>
      );
    case "warning":
      return (
        <Badge className="border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400 flex items-center justify-center">
          Warning
        </Badge>
      );
    case "rebalance-likely":
      return (
        <Badge className="border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400 flex items-center justify-center">
          Rebalance likely
        </Badge>
      );
    case "market-closed":
      return (
        <Badge className="flex items-center justify-center border-border bg-muted/50 text-muted-foreground">
          Market closed
        </Badge>
      );
    default:
      return <span className="text-muted-foreground">&mdash;</span>;
  }
}

export function LiquidityDrawerHeader({ pool }: LiquidityDrawerHeaderProps) {
  const { address } = useAccount();

  const { data: lpBalance } = useReadContract({
    address: pool.poolAddr as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const formattedLpBalance = lpBalance
    ? Number(formatUnits(lpBalance, 18)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : null;

  return (
    <div className="gap-4 p-6 pt-4 flex flex-col border-b border-border">
      {/* Token pair and badges */}
      <div className="gap-3 flex items-center">
        <div className="-space-x-2 flex">
          <TokenIcon
            token={{
              address: pool.token0.address,
              symbol: pool.token0.symbol,
            }}
            size={32}
            className="relative z-10 rounded-full"
          />
          <TokenIcon
            token={{
              address: pool.token1.address,
              symbol: pool.token1.symbol,
            }}
            size={32}
            className="rounded-full"
          />
        </div>
        <span className="font-semibold text-lg">
          {pool.token0.symbol} / {pool.token1.symbol}
        </span>
      </div>

      {/* Badges row */}
      <div className="gap-2 flex flex-wrap">
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
        <PriceAlignmentBadge status={pool.priceAlignment.status} />
      </div>

      {/* Stats strip */}
      <div className="-mx-6 px-6 py-3 gap-2 text-xs flex flex-col bg-muted/30">
        <div className="flex items-center">
          {/* Reserves */}
          <div className="gap-1.5 flex items-center">
            <span className="text-muted-foreground">Reserves:</span>
            <span className="font-medium">
              {pool.reserves.token0} {pool.token0.symbol} ·{" "}
              {pool.reserves.token1} {pool.token1.symbol}
            </span>
          </div>

          {/* Fees */}
          <div className="gap-1.5 ml-4 flex items-center">
            <span className="text-muted-foreground">Fees:</span>
            <span className="font-medium">{pool.fees.total.toFixed(2)}%</span>
          </div>

          {/* Deviation */}
          {pool.priceAlignment.priceDifferencePercent !== undefined && (
            <div className="gap-1.5 ml-4 flex items-center">
              <span className="text-muted-foreground">Deviation:</span>
              <span className="font-medium">
                {pool.priceAlignment.priceDifferencePercent > 0 ? "+" : ""}
                {pool.priceAlignment.priceDifferencePercent.toFixed(0)} bps
              </span>
            </div>
          )}
        </div>

        {/* LP token balance */}
        {formattedLpBalance && (
          <div className="gap-1.5 flex items-center">
            <span className="text-muted-foreground">Your LP tokens</span>
            <span className="font-medium">{formattedLpBalance} LP</span>
          </div>
        )}
      </div>
    </div>
  );
}
