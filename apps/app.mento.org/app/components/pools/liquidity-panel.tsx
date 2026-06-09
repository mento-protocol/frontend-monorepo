import { Badge, TokenIcon, cn } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import {
  useUserPosition,
  useExplorerUrl,
  getPoolDisplayOrder,
} from "@repo/web3";
import {
  useAccount,
  useReadContract,
  useBlockNumber,
  useConfig,
  waitForTransactionReceipt,
} from "@repo/web3/wagmi";
import { decodeEventLog, erc20Abi, type Address, type Hex } from "viem";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AddLiquidityForm } from "./add-liquidity-form";
import { RemoveLiquidityForm } from "./remove-liquidity-form";
import { PoolFeePopover } from "./pool-fee-popover";
import { UserPositionCard } from "./user-position-card";

const LP_BALANCE_REFRESH_ATTEMPTS = 6;
const LP_BALANCE_REFRESH_DELAY_MS = 1_500;

interface LiquidityPanelProps {
  pool: PoolDisplay;
  mode: "deposit" | "manage";
  onClose: () => void;
  backLabel?: string;
  disabled?: boolean;
  chainId?: number;
}

type TabMode = "add" | "remove";

export function LiquidityPanel({
  pool,
  mode,
  onClose,
  backLabel = "Back to Pools",
  disabled,
  chainId,
}: LiquidityPanelProps) {
  const { displayToken0, displayToken1, displayReserve0, displayReserve1 } =
    getPoolDisplayOrder(pool);
  const { address } = useAccount();
  const resolvedChainId = chainId ?? pool.chainId;
  const explorerUrl = useExplorerUrl(resolvedChainId);
  const wagmiConfig = useConfig();
  const { data: blockNumber } = useBlockNumber({
    chainId: resolvedChainId,
    watch: !!address,
    query: { enabled: !!address },
  });

  const { data: lpBalance, refetch: refetchLpBalance } = useReadContract({
    chainId: resolvedChainId,
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

  const [optimisticLpBalance, setOptimisticLpBalance] = useState<
    bigint | undefined
  >();

  useEffect(() => {
    setOptimisticLpBalance(undefined);
  }, [pool.poolAddr, address]);

  useEffect(() => {
    if (
      optimisticLpBalance !== undefined &&
      lpBalance === optimisticLpBalance
    ) {
      setOptimisticLpBalance(undefined);
    }
  }, [lpBalance, optimisticLpBalance]);

  const effectiveLpBalance = optimisticLpBalance ?? lpBalance;
  const hasLPTokens =
    effectiveLpBalance !== undefined && effectiveLpBalance > 0n;

  const { data: position } = useUserPosition({
    pool,
    lpBalance: effectiveLpBalance,
    enabled: hasLPTokens,
    chainId: resolvedChainId,
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

  const applyLpBalanceFromReceipt = useCallback(
    async (txHash?: string) => {
      if (!txHash || !address) return;

      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: txHash as Hex,
        chainId: resolvedChainId,
      }).catch(() => null);
      if (!receipt) return;

      let delta = 0n;
      const account = address.toLowerCase();
      const lpToken = pool.poolAddr.toLowerCase();

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== lpToken) continue;

        try {
          const event = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            topics: log.topics,
          });

          if (event.eventName !== "Transfer") continue;

          const { from, to, value } = event.args;
          if (to.toLowerCase() === account) delta += value;
          if (from.toLowerCase() === account) delta -= value;
        } catch {
          // Ignore non-ERC20 logs from contracts that share the LP address.
        }
      }

      if (delta === 0n) return;

      const baseBalance = optimisticLpBalance ?? lpBalance ?? 0n;
      const nextBalance = baseBalance + delta;
      setOptimisticLpBalance(nextBalance > 0n ? nextBalance : 0n);
    },
    [
      address,
      lpBalance,
      optimisticLpBalance,
      pool.poolAddr,
      resolvedChainId,
      wagmiConfig,
    ],
  );

  const handleLiquidityUpdated = useCallback(
    async (txHash?: string) => {
      await applyLpBalanceFromReceipt(txHash);

      const previousBalance = optimisticLpBalance ?? lpBalance;

      for (let attempt = 0; attempt < LP_BALANCE_REFRESH_ATTEMPTS; attempt++) {
        const result = await refetchLpBalance();
        const nextBalance = result.data;

        if (
          nextBalance !== undefined &&
          (previousBalance === undefined || nextBalance !== previousBalance)
        ) {
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, LP_BALANCE_REFRESH_DELAY_MS),
        );
      }
    },
    [
      applyLpBalanceFromReceipt,
      lpBalance,
      optimisticLpBalance,
      refetchLpBalance,
    ],
  );

  const isRemoveDisabled = !hasLPTokens;

  const formTabs = (
    <div className="flex border-b border-border">
      <button
        onClick={() => setActiveTab("add")}
        className={cn(
          "px-6 py-3.5 text-sm font-semibold relative cursor-pointer transition-colors",
          activeTab === "add"
            ? "text-foreground"
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
              ? "text-foreground"
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
        {backLabel}
      </button>

      {/* Pool Header */}
      <div className="gap-4 px-6 py-5 flex flex-wrap items-center justify-between rounded-xl border border-border bg-card">
        <div className="gap-4 flex items-center">
          <div className="-space-x-2.5 flex">
            <TokenIcon
              token={{
                address: displayToken0.address,
                symbol: displayToken0.symbol,
              }}
              size={38}
              className="relative z-10 rounded-full"
            />
            <TokenIcon
              token={{
                address: displayToken1.address,
                symbol: displayToken1.symbol,
              }}
              size={38}
              className="rounded-full"
            />
          </div>
          <div>
            <div className="gap-2.5 flex items-center">
              <h1 className="text-2xl font-bold tracking-tight">
                {displayToken0.symbol} / {displayToken1.symbol}
              </h1>
              <Badge
                variant="secondary"
                className={cn(
                  "px-2 py-0 font-semibold tracking-wider font-mono text-[10px]",
                  pool.poolType === "FPMM" &&
                    "bg-primary/10 text-foreground dark:bg-primary/15",
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
            className="gap-1.5 px-3.5 py-2 text-xs font-medium flex items-center rounded-lg border border-primary/20 bg-primary/5 text-foreground transition-colors hover:bg-primary/10"
          >
            Explorer
            <ExternalLink className="h-3 w-3" />
          </a>
          <a
            href="https://docs.mento.org/mento-v3/dive-deeper/fpmm"
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
            {displayReserve0} {displayToken0.symbol} / {displayReserve1}{" "}
            {displayToken1.symbol}
          </div>
        </div>
        <div className="px-4 py-3 rounded-xl border border-border bg-card">
          <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Pool Fee
          </span>
          <div className="gap-1.5 text-sm font-semibold mt-1 flex items-center">
            <span>{pool.fees.lp.toFixed(2)}%</span>
            <PoolFeePopover pool={pool} />
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
          lpBalance={effectiveLpBalance}
        />
      )}

      {/* Action Panel — form handles two-column layout */}
      {activeTab === "add" ? (
        <AddLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
          header={formTabs}
          disabled={disabled}
        />
      ) : (
        <RemoveLiquidityForm
          pool={pool}
          onLiquidityUpdated={handleLiquidityUpdated}
          header={formTabs}
          disabled={disabled}
        />
      )}
    </div>
  );
}
