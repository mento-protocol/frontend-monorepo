import { Star } from "lucide-react";
import { Badge, Button, TokenIcon, cn } from "@repo/ui";
import {
  type PoolDisplay,
  type PoolRewardInfo,
  chainIdToChain,
  type ChainId,
} from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, type Address } from "viem";
import Link from "next/link";
import Image from "next/image";
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
  poolHref?: string;
  rewards?: PoolRewardInfo;
}

export function PoolRow({ pool, onSelect, poolHref, rewards }: PoolRowProps) {
  const { address } = useAccount();

  const { data: lpBalance } = useReadContract({
    chainId: pool.chainId,
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
  const rebalanceDue = !!pool.rebalancing?.canRebalance;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        isLegacy && "opacity-60",
      )}
    >
      <div className="gap-4 px-4 py-4 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] md:items-center md:gap-4 flex flex-col">
        <div className="gap-3 flex items-center">
          <div className="-space-x-2 flex shrink-0">
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
              <ChainBadge chainId={pool.chainId} />
              <PoolAddressPopover pool={pool} />
            </div>

            <div className="gap-1.5 flex flex-wrap items-center">
              <Badge
                variant="secondary"
                className={cn(
                  "px-1 py-0 text-[10px]",
                  pool.poolType === "FPMM"
                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                    : "",
                )}
              >
                {pool.poolType === "FPMM" ? "FPMM" : "LEGACY"}
              </Badge>

              {rewards && (
                <Badge
                  variant="secondary"
                  className="gap-1 px-1 py-0 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 font-semibold text-[10px]"
                >
                  <Star className="h-2.5 w-2.5 fill-current" />+
                  {rewards.apr.toFixed(1)}%
                </Badge>
              )}

              {pool.poolType === "FPMM" && rebalanceDue && (
                <Badge
                  variant="secondary"
                  className="gap-1 px-1 py-0 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  Rebalance Due
                </Badge>
              )}
            </div>
          </div>

          <div className="gap-2 md:hidden ml-auto flex items-center">
            {pool.poolType === "FPMM" && poolHref ? (
              <Button size="sm" className="h-8" asChild>
                <Link href={`${poolHref}${hasLPTokens ? "?mode=manage" : ""}`}>
                  {hasLPTokens ? "Manage" : "Deposit"}
                </Link>
              </Button>
            ) : pool.poolType === "FPMM" ? (
              <Button
                size="sm"
                className="h-8"
                onClick={() =>
                  onSelect(pool, hasLPTokens ? "manage" : "deposit")
                }
              >
                {hasLPTokens ? "Manage" : "Deposit"}
              </Button>
            ) : null}
          </div>
        </div>

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
                  style={{ width: `${(1 - token0Ratio) * 100}%` }}
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

        <div className="md:pl-4 flex flex-col justify-center">
          <span className="text-xs md:hidden text-muted-foreground">Fee</span>
          <div className="gap-1.5 flex items-center">
            <span className="font-mono text-sm font-medium tabular-nums">
              {pool.fees.total.toFixed(2)}%
            </span>
            <PoolFeePopover pool={pool} />
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-xs md:hidden text-muted-foreground">TVL</span>
          <span className="font-mono text-sm font-medium tabular-nums">
            {pool.tvl !== null ? formatCompactTvl(pool.tvl) : "--"}
          </span>
        </div>

        <div className="min-h-8 gap-2 md:flex hidden items-center justify-end">
          {pool.poolType === "FPMM" && poolHref ? (
            <Button size="sm" className="h-8" asChild>
              <Link href={`${poolHref}${hasLPTokens ? "?mode=manage" : ""}`}>
                {hasLPTokens ? "Manage" : "Deposit"}
              </Link>
            </Button>
          ) : pool.poolType === "FPMM" ? (
            <Button
              size="sm"
              className="h-8"
              onClick={() => onSelect(pool, hasLPTokens ? "manage" : "deposit")}
            >
              {hasLPTokens ? "Manage" : "Deposit"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChainBadge({ chainId }: { chainId: ChainId }) {
  const chain = chainIdToChain[chainId];
  if (!chain) return null;

  const iconUrl = (chain as unknown as Record<string, unknown>)?.iconUrl as
    | string
    | undefined;

  if (!iconUrl) return null;

  return (
    <Image
      src={iconUrl}
      alt={chain.name}
      width={16}
      height={16}
      className="h-4 w-4 rounded-full"
      title={chain.name}
      unoptimized
    />
  );
}
