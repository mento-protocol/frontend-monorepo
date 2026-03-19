"use client";

import { useSetAtom } from "jotai";
import { ArrowDown, ArrowUp, Coins } from "lucide-react";
import { Button, TokenIcon } from "@repo/ui";
import {
  type PoolDisplay,
  usePoolRebalancePreview,
  useRebalanceTransaction,
  executeLiquidityFlow,
  liquidityFlowAtom,
  type LiquidityFlowStepDefinition,
} from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { formatUnits, type Address } from "viem";

function formatAmount(amount: bigint, decimals = 18): string {
  const num = Number(formatUnits(amount, decimals));
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  if (num < 0.01 && num > 0) return "<0.01";
  return num.toFixed(2);
}

function resolveTokenSymbol(tokenAddress: string, pool: PoolDisplay): string {
  if (tokenAddress.toLowerCase() === pool.token0.address.toLowerCase()) {
    return pool.token0.symbol;
  }
  if (tokenAddress.toLowerCase() === pool.token1.address.toLowerCase()) {
    return pool.token1.symbol;
  }
  return tokenAddress.slice(0, 6) + "...";
}

function resolveTokenAddress(tokenAddress: string, pool: PoolDisplay): string {
  if (tokenAddress.toLowerCase() === pool.token0.address.toLowerCase()) {
    return pool.token0.address;
  }
  if (tokenAddress.toLowerCase() === pool.token1.address.toLowerCase()) {
    return pool.token1.address;
  }
  return tokenAddress;
}

interface RebalancePanelProps {
  pool: PoolDisplay;
}

export function RebalancePanel({ pool }: RebalancePanelProps) {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const {
    data: preview,
    isLoading,
    isFetching,
    isError,
  } = usePoolRebalancePreview(pool);
  const { buildTransaction, handleSuccess, isBuilding } =
    useRebalanceTransaction(pool);

  const handleRebalance = async () => {
    if (!address || !preview) return;

    const tx = await buildTransaction(address as Address);

    const steps: LiquidityFlowStepDefinition[] = [];

    if (tx.approval) {
      steps.push({
        id: "approve",
        label: `Approve ${resolveTokenSymbol(preview.inputToken, pool)}`,
        buildTx: async () => tx.approval!.params,
      });
    }

    steps.push({
      id: "rebalance",
      label: `Rebalance ${pool.token0.symbol} / ${pool.token1.symbol}`,
      buildTx: async () => tx.rebalance.params,
    });

    const result = await executeLiquidityFlow(
      wagmiConfig,
      setFlow,
      "Rebalance Pool",
      steps,
      pool.chainId,
    );

    if (result.success && result.txHashes.length > 0) {
      await handleSuccess(result.txHashes[result.txHashes.length - 1]!);
    }
  };

  if (isLoading || isFetching) {
    return (
      <div className="px-4 py-4 border-t border-border">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !preview) {
    return (
      <div className="px-4 py-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          {isError
            ? "Failed to load rebalance data. Please try again."
            : "No rebalance data available for this pool."}
        </p>
      </div>
    );
  }

  const inputSymbol = resolveTokenSymbol(preview.inputToken, pool);
  const outputSymbol = resolveTokenSymbol(preview.outputToken, pool);
  const inputAddress = resolveTokenAddress(preview.inputToken, pool);
  const outputAddress = resolveTokenAddress(preview.outputToken, pool);
  const isExpansion = preview.direction === "Expand";

  return (
    <div className="px-4 py-4 border-t border-border">
      <div className="gap-4 md:flex-row md:items-end md:justify-between flex flex-col">
        {/* Info section */}
        <div className="gap-4 md:grid-cols-3 grid flex-1 grid-cols-1">
          {/* You provide */}
          <div className="gap-2 flex items-start">
            <div className="mt-0.5 h-8 w-8 bg-red-500/10 text-red-500 flex shrink-0 items-center justify-center rounded-lg">
              <ArrowUp className="h-4 w-4" />
            </div>
            <div>
              <div className="font-mono tracking-widest text-[10px] text-muted-foreground uppercase">
                You Provide
              </div>
              <div className="gap-1.5 mt-0.5 flex items-center">
                <TokenIcon
                  token={{ address: inputAddress, symbol: inputSymbol }}
                  size={20}
                  className="shrink-0 rounded-full"
                />
                <span className="text-sm font-bold tabular-nums">
                  {formatAmount(preview.amountRequired.amount)}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {inputSymbol}
                </span>
              </div>
            </div>
          </div>

          {/* You receive */}
          <div className="gap-2 flex items-start">
            <div className="mt-0.5 h-8 w-8 bg-green-500/10 text-green-500 flex shrink-0 items-center justify-center rounded-lg">
              <ArrowDown className="h-4 w-4" />
            </div>
            <div>
              <div className="font-mono tracking-widest text-[10px] text-muted-foreground uppercase">
                You Receive
              </div>
              <div className="gap-1.5 mt-0.5 flex items-center">
                <TokenIcon
                  token={{ address: outputAddress, symbol: outputSymbol }}
                  size={20}
                  className="shrink-0 rounded-full"
                />
                <span className="text-sm font-bold tabular-nums">
                  {formatAmount(preview.amountTransferred.amount)}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {outputSymbol}
                </span>
              </div>
            </div>
          </div>

          {/* Your earnings */}
          <div className="gap-2 flex items-start">
            <div className="mt-0.5 h-8 w-8 flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Coins className="h-4 w-4" />
            </div>
            <div>
              <div className="font-mono tracking-widest text-[10px] text-muted-foreground uppercase">
                Your Earnings
              </div>
              <div className="gap-1.5 mt-0.5 flex items-center">
                <TokenIcon
                  token={{ address: outputAddress, symbol: outputSymbol }}
                  size={20}
                  className="shrink-0 rounded-full"
                />
                <span className="text-sm font-bold text-primary tabular-nums">
                  {formatAmount(preview.liquiditySourceIncentive.amount)}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {outputSymbol}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action section */}
        <div className="gap-2 flex flex-col items-end">
          <span className="px-2 py-0.5 font-mono tracking-wider rounded-md bg-muted text-[10px] text-muted-foreground">
            {isExpansion ? "EXPANSION" : "CONTRACTION"}
          </span>
          {isConnected ? (
            <Button
              size="sm"
              className="h-8 min-w-[120px]"
              disabled={isBuilding}
              onClick={handleRebalance}
            >
              {isBuilding ? "Preparing..." : "Rebalance"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Connect wallet to rebalance
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
