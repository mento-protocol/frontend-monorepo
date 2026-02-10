import { Button, TokenIcon, cn, Badge } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract } from "@repo/web3/wagmi";
import { erc20Abi, type Address } from "viem";
import { PoolAddressPopover } from "./pool-address-popover";
import { PoolDetailsAccordion } from "./pool-details-accordion";
import { LiquidityDrawer } from "./liquidity-drawer";
import { PriceAlignmentBadge } from "./price-alignment-badge";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface PoolRowProps {
  pool: PoolDisplay;
}

export function PoolRow({ pool }: PoolRowProps) {
  const { address } = useAccount();
  const [isExpanded, setIsExpanded] = useState(false);
  const [drawerState, setDrawerState] = useState<{
    isOpen: boolean;
    mode: "deposit" | "manage" | null;
  }>({ isOpen: false, mode: null });

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
  const canExpand =
    pool.poolType === "FPMM" && !!pool.pricing && !!pool.rebalancing;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        isLegacy && "opacity-60",
      )}
    >
      <div
        className={cn(
          "gap-4 px-4 py-4 grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1.5fr)] items-center",
          canExpand && "cursor-pointer transition-colors hover:bg-muted/30",
        )}
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
      >
        {/* Pool */}
        <div className="gap-3 flex items-center">
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform",
              canExpand ? "text-muted-foreground" : "invisible",
              isExpanded && "rotate-180",
            )}
          />
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
              <div onClick={(e) => e.stopPropagation()}>
                <PoolAddressPopover pool={pool} />
              </div>
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
        </div>

        {/* Reserves */}
        <div className="gap-1.5 flex flex-col">
          <div className="text-sm flex justify-between text-muted-foreground">
            <span>
              {pool.reserves.token0}{" "}
              <span className="font-semibold">{pool.token0.symbol}</span>
            </span>
            <span>
              {pool.reserves.token1}{" "}
              <span className="font-semibold">{pool.token1.symbol}</span>
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
          {pool.poolType === "FPMM" && (
            <Button
              size="sm"
              className="h-8"
              onClick={(e) => {
                e.stopPropagation();
                setDrawerState({
                  isOpen: true,
                  mode: hasLPTokens ? "manage" : "deposit",
                });
              }}
            >
              {hasLPTokens ? "Manage" : "Deposit"}
            </Button>
          )}
        </div>
      </div>

      {/* Expandable details section */}
      {canExpand && (
        <div
          className={cn(
            "ease-in-out grid transition-all duration-300",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <PoolDetailsAccordion pool={pool} />
          </div>
        </div>
      )}

      {/* Liquidity management drawer */}
      {drawerState.mode && (
        <LiquidityDrawer
          pool={pool}
          isOpen={drawerState.isOpen}
          onOpenChange={(open) =>
            setDrawerState((prev) => ({ isOpen: open, mode: prev.mode }))
          }
          mode={drawerState.mode}
          hasLPTokens={hasLPTokens}
        />
      )}
    </div>
  );
}
