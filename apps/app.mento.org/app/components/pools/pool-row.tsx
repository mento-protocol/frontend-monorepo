import { Button, TokenIcon, cn, Badge } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, type Address } from "viem";
import { PoolAddressPopover } from "./pool-address-popover";
import { PoolFeePopover } from "./pool-fee-popover";

function formatCompactTvl(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(1)}`;
}

interface PoolRowProps {
  pool: PoolDisplay;
  onSelect: (pool: PoolDisplay, mode: "deposit" | "manage") => void;
}

export function PoolRow({ pool, onSelect }: PoolRowProps) {
  const { address } = useAccount();

  const { data: lpBalance } = useReadContract({
    address: pool.poolAddr as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: pool.poolType === "FPMM" && !!address,
    },
  });

  const hasLPTokens = lpBalance !== undefined && lpBalance > 0n;
  const isLegacy = pool.poolType === "Legacy";
  const hasLiquidity = pool.reserves.hasLiquidity;
  const token0Ratio = Math.max(0, Math.min(1, pool.reserves.token0Ratio));
  const token0Percent = Math.round(token0Ratio * 100);
  const token1Percent = 100 - token0Percent;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        isLegacy && "opacity-60",
      )}
    >
      <div className="gap-4 md:gap-8 px-4 py-4 md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_minmax(0,1fr)] md:items-center flex flex-col">
        {/* Pool info + action (mobile: row with action on right) */}
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
          <div className="gap-1 flex flex-col">
            <div className="gap-1.5 flex items-center">
              <span className="text-sm font-medium">
                {pool.token0.symbol} / {pool.token1.symbol}
              </span>
              <PoolAddressPopover pool={pool} />
            </div>
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
          {/* Action button - mobile only, aligned to right */}
          <div className="md:hidden ml-auto">
            {pool.poolType === "FPMM" && (
              <Button
                size="sm"
                className="h-8"
                onClick={() =>
                  onSelect(pool, hasLPTokens ? "manage" : "deposit")
                }
              >
                {hasLPTokens ? "Manage" : "Deposit"}
              </Button>
            )}
          </div>
        </div>

        {/* Reserves */}
        <div className="gap-1.5 flex flex-col">
          <div className="text-sm flex justify-between text-muted-foreground">
            <span className="font-mono tabular-nums">
              {pool.reserves.token0}{" "}
              <span className="font-semibold font-sans">
                {pool.token0.symbol}
              </span>
            </span>
            <span className="font-mono tabular-nums">
              {pool.reserves.token1}{" "}
              <span className="font-semibold font-sans">
                {pool.token1.symbol}
              </span>
            </span>
          </div>
          {hasLiquidity ? (
            <div className="relative">
              <div className="h-2.5 flex w-full overflow-hidden rounded-full">
                <div
                  className="ease-out bg-primary transition-[width] duration-400"
                  style={{ width: `${token0Ratio * 100}%` }}
                />
                <div
                  className="ease-out bg-primary-border/70 transition-[width] duration-400"
                  style={{
                    width: `${(1 - token0Ratio) * 100}%`,
                  }}
                />
              </div>
              <div
                className="-top-0.5 h-3.5 w-0.5 absolute rounded-sm bg-foreground/70 shadow-[0_0_6px_rgba(255,255,255,0.3)]"
                style={{
                  left: `${token0Ratio * 100}%`,
                  transform: "translateX(-50%)",
                }}
              />
              <div className="mt-1 font-semibold tracking-wide flex justify-between text-[10px]">
                <span className="text-primary">{token0Percent}%</span>
                <span className="text-primary-border">{token1Percent}%</span>
              </div>
            </div>
          ) : (
            <div className="gap-1 flex flex-col">
              <div className="h-1.5 w-full rounded-full bg-muted/70" />
              <span className="text-[11px] text-muted-foreground">
                No liquidity yet
              </span>
            </div>
          )}
        </div>

        {/* Fees */}
        <div className="flex flex-col justify-center">
          <span className="text-xs md:hidden text-muted-foreground">Fee</span>
          <div className="gap-1.5 flex items-center">
            <span className="text-sm font-medium font-mono tabular-nums">
              {pool.fees.total.toFixed(2)}%
            </span>
            <PoolFeePopover pool={pool} />
          </div>
        </div>

        {/* TVL */}
        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">TVL</span>
          <span className="text-sm font-medium font-mono tabular-nums">
            {pool.tvl !== null ? formatCompactTvl(pool.tvl) : "--"}
          </span>
        </div>

        {/* Actions - desktop only */}
        <div className="gap-2 md:flex min-h-8 hidden items-center justify-end">
          {pool.poolType === "FPMM" && (
            <Button
              size="sm"
              className="h-8"
              onClick={() => onSelect(pool, hasLPTokens ? "manage" : "deposit")}
            >
              {hasLPTokens ? "Manage" : "Deposit"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
