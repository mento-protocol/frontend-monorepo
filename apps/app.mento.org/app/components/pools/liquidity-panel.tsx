import { Badge, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useAccount, useReadContract, useBlockNumber } from "@repo/web3/wagmi";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { AddLiquidityForm } from "./add-liquidity-form";
import { RemoveLiquidityForm } from "./remove-liquidity-form";
import { LiquidityFlowDialog } from "./liquidity-flow-dialog";

interface LiquidityPanelProps {
  pool: PoolDisplay;
  mode: "deposit" | "manage";
  onClose: () => void;
}

type TabMode = "add" | "remove";

export function LiquidityPanel({ pool, mode, onClose }: LiquidityPanelProps) {
  const { address } = useAccount();
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
  const formattedLpBalance = lpBalance
    ? Number(formatUnits(lpBalance, 18)).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : null;

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

  return (
    <div className="shadow-sm animate-in fade-in slide-in-from-top-2 w-full border border-border bg-card duration-300">
      {/* Header */}
      <div className="md:flex-row md:items-center px-6 py-4 gap-4 flex flex-col justify-between border-b border-border">
        <div className="gap-4 flex items-center">
          <button
            onClick={onClose}
            className="gap-1.5 text-sm flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to pools
          </button>
          <div className="h-5 md:block hidden w-px bg-border" />
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
            <div>
              <span className="font-semibold text-foreground">
                {pool.token0.symbol} / {pool.token1.symbol}
              </span>
              <div className="gap-2 mt-0.5 flex items-center">
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
          </div>
        </div>

        {/* Pool Metrics (compact) */}
        <div className="gap-6 text-md flex items-center">
          <div>
            <span className="text-muted-foreground">Reserves</span>
            <p className="font-medium">
              {pool.reserves.token0} {pool.token0.symbol} /{" "}
              {pool.reserves.token1} {pool.token1.symbol}
            </p>
          </div>
          {formattedLpBalance && (
            <div>
              <span className="text-muted-foreground">Your LP</span>
              <p className="font-medium">{formattedLpBalance} LP</p>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 border-b border-border">
        <div className="gap-6 flex">
          <button
            onClick={() => setActiveTab("add")}
            className={cn(
              "py-3 text-sm font-medium relative cursor-pointer transition-colors",
              activeTab === "add"
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Add liquidity
            {activeTab === "add" && (
              <span className="bottom-0 left-0 right-0 h-0.5 absolute bg-primary" />
            )}
          </button>
          <button
            onClick={() => !isRemoveDisabled && setActiveTab("remove")}
            disabled={isRemoveDisabled}
            className={cn(
              "py-3 text-sm font-medium relative cursor-pointer transition-colors",
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
            Remove liquidity
            {activeTab === "remove" && (
              <span className="bottom-0 left-0 right-0 h-0.5 absolute bg-primary" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === "add" ? (
        <AddLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
        />
      ) : (
        <RemoveLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
        />
      )}

      <LiquidityFlowDialog />
    </div>
  );
}
