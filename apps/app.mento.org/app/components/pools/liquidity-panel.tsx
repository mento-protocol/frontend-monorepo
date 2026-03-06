import { Badge, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useUserPosition, useExplorerUrl } from "@repo/web3";
import { useAccount, useReadContract, useBlockNumber } from "@repo/web3/wagmi";
import { erc20Abi, type Address } from "viem";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AddLiquidityForm } from "./add-liquidity-form";
import { RemoveLiquidityForm } from "./remove-liquidity-form";
import { LiquidityFlowDialog } from "./liquidity-flow-dialog";
import { UserPositionCard } from "./user-position-card";

interface LiquidityPanelProps {
  pool: PoolDisplay;
  mode: "deposit" | "manage";
  onClose: () => void;
}

type TabMode = "add" | "remove";

export function LiquidityPanel({ pool, mode, onClose }: LiquidityPanelProps) {
  const { address } = useAccount();
  const explorerUrl = useExplorerUrl();
  const { data: blockNumber } = useBlockNumber({
    watch: !!address,
    query: { enabled: !!address },
  });

  const { data: lpBalance, refetch: refetchLpBalance } = useReadContract({
    address: pool.poolAddr as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      staleTime: 0,
      refetchOnMount: true,
    },
  });

  const hasLPTokens = lpBalance !== undefined && lpBalance > 0n;

  const { data: position } = useUserPosition({
    pool,
    lpBalance,
    enabled: hasLPTokens,
  });

  const [activeTab, setActiveTab] = useState<TabMode>(
    mode === "deposit" ? "add" : "remove",
  );

  useEffect(() => {
    if (!hasLPTokens && activeTab === "remove") {
      setActiveTab("add");
    }
  }, [hasLPTokens, activeTab]);

  useEffect(() => {
    if (!address || blockNumber === undefined) return;
    void refetchLpBalance();
  }, [address, blockNumber, refetchLpBalance]);

  const handleLiquidityUpdated = useCallback(async () => {
    await refetchLpBalance();
  }, [refetchLpBalance]);

  const isRemoveDisabled = !hasLPTokens;

  const formTabs = (
    <div className="flex border-b border-border">
      <button
        onClick={() => setActiveTab("add")}
        className={cn(
          "px-6 py-3.5 text-sm font-semibold relative cursor-pointer transition-colors",
          activeTab === "add"
            ? "text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Add Liquidity
        {activeTab === "add" && (
          <span className="bottom-0 left-0 right-0 h-0.5 absolute bg-primary" />
        )}
      </button>
      <button
        onClick={() => !isRemoveDisabled && setActiveTab("remove")}
        disabled={isRemoveDisabled}
        className={cn(
          "px-6 py-3.5 text-sm font-semibold relative cursor-pointer transition-colors",
          isRemoveDisabled
            ? "cursor-not-allowed text-muted-foreground/50"
            : activeTab === "remove"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
        )}
        title={
          isRemoveDisabled
            ? "Available only when you have added liquidity"
            : undefined
        }
      >
        Remove Liquidity
        {activeTab === "remove" && (
          <span className="bottom-0 left-0 right-0 h-0.5 absolute bg-primary" />
        )}
      </button>
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-top-2 space-y-5 w-full duration-300">
      {/* Back nav */}
      <button
        onClick={onClose}
        className="gap-1.5 text-sm flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Pools
      </button>

      {/* Pool Header */}
      <div className="gap-4 px-6 py-5 flex flex-wrap items-center justify-between rounded-xl border border-border bg-card">
        <div className="gap-4 flex items-center">
          <div className="-space-x-2.5 flex">
            <TokenIcon
              token={{
                address: pool.token0.address,
                symbol: pool.token0.symbol,
              }}
              size={38}
              className="relative z-10 rounded-full"
            />
            <TokenIcon
              token={{
                address: pool.token1.address,
                symbol: pool.token1.symbol,
              }}
              size={38}
              className="rounded-full"
            />
          </div>
          <div>
            <div className="gap-2.5 flex items-center">
              <h1 className="text-2xl font-bold tracking-tight">
                {pool.token0.symbol} / {pool.token1.symbol}
              </h1>
              <Badge
                variant="secondary"
                className={cn(
                  "px-2 py-0 font-semibold tracking-wider font-mono text-[10px]",
                  pool.poolType === "FPMM" &&
                    "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary",
                )}
              >
                {pool.poolType === "FPMM" ? "FPMM" : "LEGACY"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage your liquidity position
            </p>
          </div>
        </div>
        <div className="gap-2 flex">
          <a
            href={`${explorerUrl}/address/${pool.poolAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1.5 px-3.5 py-2 text-xs font-medium flex items-center rounded-lg border border-primary/20 bg-primary/5 text-primary transition-colors hover:bg-primary/10"
          >
            Explorer
            <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="https://docs.mento.org/mento/overview/core-concepts/fixed-price-market-makers-fpmms"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-1.5 px-3.5 py-2 text-xs font-medium flex items-center rounded-lg border border-border bg-muted/30 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            FPMM Docs
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Reserves / Fee / TVL stats */}
      <div className="gap-4 grid grid-cols-3">
        <div className="px-4 py-3 rounded-xl border border-border bg-card">
          <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Reserves
          </span>
          <div className="text-sm font-semibold mt-1">
            {pool.reserves.token0} {pool.token0.symbol} / {pool.reserves.token1}{" "}
            {pool.token1.symbol}
          </div>
        </div>
        <div className="px-4 py-3 rounded-xl border border-border bg-card">
          <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Pool Fee
          </span>
          <div className="text-sm font-semibold mt-1">
            {pool.fees.total.toFixed(1)}%
          </div>
        </div>
        <div className="px-4 py-3 rounded-xl border border-border bg-card">
          <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            TVL
          </span>
          <div className="text-sm font-semibold mt-1">
            {pool.tvl !== null
              ? `$${pool.tvl.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : "—"}
          </div>
        </div>
      </div>

      {/* Position Card */}
      {position && (
        <UserPositionCard
          pool={pool}
          position={position}
          lpBalance={lpBalance}
        />
      )}

      {/* Action Panel — form handles two-column layout */}
      {activeTab === "add" ? (
        <AddLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
          header={formTabs}
        />
      ) : (
        <RemoveLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
          header={formTabs}
        />
      )}

      <LiquidityFlowDialog />
    </div>
  );
}
