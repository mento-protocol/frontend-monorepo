import { Badge, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { PriceAlignmentBadge } from "./price-alignment-badge";

interface LiquidityDrawerHeaderProps {
  pool: PoolDisplay;
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
