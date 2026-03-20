"use client";

import { useSetAtom } from "jotai";
import { AlertTriangle, Equal } from "lucide-react";
import { Badge, Button, TokenIcon } from "@repo/ui";
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

function computeExchangeRate(
  amountIn: bigint,
  decimalsIn: number,
  amountOut: bigint,
  decimalsOut: number,
): string {
  const numIn = Number(formatUnits(amountIn, decimalsIn));
  const numOut = Number(formatUnits(amountOut, decimalsOut));
  if (numIn <= 0) return "—";
  return (numOut / numIn).toFixed(2);
}

function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function getReserveSharePercentForThreshold(
  deviationPercent: number,
  isPoolPriceAbove: boolean,
): number {
  const normalizedDeviation = Math.max(0, deviationPercent) / 100;
  const relativePoolPrice = isPoolPriceAbove
    ? 1 + normalizedDeviation
    : 1 - normalizedDeviation;

  if (relativePoolPrice <= 0) return 100;

  // The bar shows token0's value share at oracle price, not raw price deviation.
  return clampPercent(100 / (1 + relativePoolPrice));
}

interface RebalancePanelProps {
  pool: PoolDisplay;
  onRebalanceComplete?: () => void;
}

export function RebalancePanel({
  pool,
  onRebalanceComplete,
}: RebalancePanelProps) {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const { data: preview, isLoading, isError } = usePoolRebalancePreview(pool);
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
      onRebalanceComplete?.();
    }
  };

  if (isLoading && !preview) {
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

  const inputDecimals =
    inputAddress.toLowerCase() === pool.token0.address.toLowerCase()
      ? pool.token0.decimals
      : pool.token1.decimals;
  const outputDecimals =
    outputAddress.toLowerCase() === pool.token0.address.toLowerCase()
      ? pool.token0.decimals
      : pool.token1.decimals;

  const exchangeRate = computeExchangeRate(
    preview.amountRequired.amount,
    inputDecimals,
    preview.amountTransferred.amount,
    outputDecimals,
  );
  const oracleRateLabel =
    pool.pricing?.oraclePrice !== undefined
      ? `1 ${pool.token0.symbol} = ${pool.pricing.oraclePrice.toFixed(2)} ${pool.token1.symbol}`
      : null;
  const poolRateLabel =
    pool.pricing?.poolPrice !== undefined
      ? `1 ${pool.token0.symbol} = ${pool.pricing.poolPrice.toFixed(2)} ${pool.token1.symbol}`
      : null;

  const token0Ratio = Math.max(0, Math.min(1, pool.reserves.token0Ratio));
  const token0Percent = Math.round(token0Ratio * 100);
  const token1Percent = 100 - token0Percent;

  const incentivePercent = pool.rebalancing?.incentivePercent ?? 0;
  const isExpansion = preview.direction === "Expand";
  const isPoolPriceAbove = pool.pricing?.isPoolPriceAbove ?? false;

  const deviationPercent = Math.abs(
    pool.priceAlignment.priceDifferencePercent ??
      (pool.pricing?.deviationBps ? pool.pricing.deviationBps / 100 : 0),
  );

  // Map price-deviation thresholds onto the reserve-share bar.
  const thresholdAbove = pool.rebalancing?.thresholdAboveBps
    ? pool.rebalancing.thresholdAboveBps / 100
    : 0;
  const thresholdBelow = pool.rebalancing?.thresholdBelowBps
    ? pool.rebalancing.thresholdBelowBps / 100
    : 0;
  const thresholdAbovePos = getReserveSharePercentForThreshold(
    thresholdAbove,
    true,
  );
  const thresholdBelowPos = getReserveSharePercentForThreshold(
    thresholdBelow,
    false,
  );

  const activeThreshold = isPoolPriceAbove ? thresholdAbove : thresholdBelow;
  const activeThresholdPos = isPoolPriceAbove
    ? thresholdAbovePos
    : thresholdBelowPos;
  const activeThresholdRelation = isPoolPriceAbove ? "above" : "below";
  const currentDeviationLabel = `${deviationPercent.toFixed(1)}% ${activeThresholdRelation} oracle`;
  const expectedRateLabel = `1 ${inputSymbol} = ${exchangeRate} ${outputSymbol}`;
  const bonusLabel = `+${formatAmount(
    preview.liquiditySourceIncentive.amount,
    outputDecimals,
  )} ${outputSymbol}`;

  return (
    <div className="px-4 pb-4 pt-4 border-t border-border">
      <div className="border-amber-500/10 bg-amber-500/5 overflow-hidden rounded-lg border">
        <div className="p-4 md:p-5 space-y-5">
          {/* Header */}
          <div className="gap-2 flex items-center">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-semibold">
              This pool is out of balance.
            </span>
          </div>

          {/* Main content: left column (description + bar + cards) + right column (gauge) */}
          <div className="md:grid-cols-[1fr_auto] gap-4 md:gap-6 grid grid-cols-1 items-start">
            <div className="space-y-4">
              {/* Description */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                This pool needs more {inputSymbol} and has extra {outputSymbol}.
                Deposit {inputSymbol}, receive {outputSymbol}, and earn a
                rebalance bonus. To learn more, read the{" "}
                <a
                  href="https://docs.mento.org/mento-v3/dive-deeper/fpmm/rebalancing-and-strategies"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
                >
                  docs
                </a>
                .
              </p>

              {/* Direction & price info row */}
              <div className="gap-2 text-xs flex flex-wrap items-center">
                <Badge
                  variant="secondary"
                  className="px-1.5 py-0 font-semibold text-[10px]"
                >
                  {isExpansion ? "Expansion" : "Contraction"}
                </Badge>
                {pool.pricing && (
                  <span className="font-mono text-muted-foreground">
                    Pool price{" "}
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {deviationPercent.toFixed(1)}%{" "}
                      {isPoolPriceAbove ? "above" : "below"}
                    </span>{" "}
                    oracle
                  </span>
                )}
                {activeThreshold > 0 && (
                  <>
                    <span className="text-muted-foreground/30">|</span>
                    <span className="font-mono text-muted-foreground">
                      Rebalance starts at{" "}
                      <span className="text-foreground/70">
                        {activeThreshold.toFixed(1)}% {activeThresholdRelation}{" "}
                        oracle
                      </span>
                    </span>
                  </>
                )}
              </div>

              {/* Reserve imbalance bar */}
              <div className="space-y-3 p-3 rounded-lg border border-border bg-incard">
                <div className="gap-2 md:flex-row md:items-start md:justify-between flex flex-col">
                  <div className="space-y-0.5">
                    <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                      Reserve Mix (by value)
                    </div>
                    <div className="font-mono text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {token0Percent}% {pool.token0.symbol}
                      </span>
                      <span className="text-muted-foreground/40"> | </span>
                      <span className="font-semibold text-foreground">
                        {token1Percent}% {pool.token1.symbol}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5 md:text-right">
                    <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                      Price vs Oracle
                    </div>
                    <div className="font-mono text-sm text-muted-foreground">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        {deviationPercent.toFixed(1)}% {activeThresholdRelation}{" "}
                        oracle
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Too much{" "}
                  <span className="font-semibold text-foreground">
                    {outputSymbol}
                  </span>
                  . Too little{" "}
                  <span className="font-semibold text-foreground">
                    {inputSymbol}
                  </span>
                  . White = 50/50 target. Yellow = rebalance trigger.
                </p>

                <div className="gap-x-4 gap-y-1 font-mono flex flex-wrap items-center text-[10px] text-muted-foreground/80">
                  <span className="gap-1.5 inline-flex items-center">
                    <span className="h-3 w-0.5 rounded-full bg-foreground/70 shadow-[0_0_4px_rgba(255,255,255,0.3)]" />
                    Target 50/50
                  </span>
                  {activeThreshold > 0 && (
                    <span className="gap-1.5 text-amber-600 dark:text-amber-400 inline-flex items-center">
                      <span className="h-3 w-px border-l border-dashed border-current" />
                      Rebalance trigger: {activeThreshold.toFixed(1)}%{" "}
                      {activeThresholdRelation} oracle
                    </span>
                  )}
                </div>

                {/* Bar visualization */}
                <div className="space-y-2">
                  <div className="relative">
                    <div className="h-3.5 ring-white/5 flex w-full overflow-hidden rounded-full bg-muted/20 ring-1">
                      <div
                        className="ease-out bg-linear-to-r from-primary to-primary/80 transition-[width] duration-400"
                        style={{ width: `${token0Ratio * 100}%` }}
                      />
                      <div
                        className="ease-out bg-linear-to-r from-primary-border/80 to-primary-border/60 transition-[width] duration-400"
                        style={{ width: `${(1 - token0Ratio) * 100}%` }}
                      />
                    </div>
                    {/* 50% target marker (solid white) */}
                    <div
                      className="-top-0.5 h-4 w-0.5 absolute bg-foreground/80 shadow-[0_0_4px_rgba(255,255,255,0.3)]"
                      style={{ left: "50%", transform: "translateX(-50%)" }}
                    />
                    {/* Active rebalance threshold marker (dashed) */}
                    {activeThreshold > 0 && (
                      <div
                        className="-top-0.5 h-4 border-amber-500/70 absolute w-px border-l border-dashed"
                        style={{
                          left: `${activeThresholdPos}%`,
                          transform: "translateX(-50%)",
                        }}
                      />
                    )}
                  </div>

                  <div className="font-mono flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{pool.token0.symbol} share</span>
                    <span>{pool.token1.symbol} share</span>
                  </div>
                </div>

                <div className="text-sm font-mono flex justify-between">
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    -{" "}
                    {formatAmount(preview.amountRequired.amount, inputDecimals)}{" "}
                    {inputSymbol}
                  </span>
                  <span className="font-semibold text-green-500">
                    +{" "}
                    {formatAmount(
                      preview.amountTransferred.amount,
                      outputDecimals,
                    )}{" "}
                    {outputSymbol}
                  </span>
                </div>
              </div>

              {/* Bottom cards: Deposit / Receive / Reward */}
              <div className="text-xs font-mono font-semibold tracking-wider mt-1 text-muted-foreground uppercase">
                Rebalance Preview
              </div>
              <div className="md:grid-cols-[1fr_auto_1fr_1fr] gap-3 grid grid-cols-1 items-stretch">
                {/* You Deposit */}
                <div className="p-3 space-y-1 rounded-lg border border-border bg-incard">
                  <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                    You deposit
                  </div>
                  <div className="gap-2 flex items-baseline">
                    <span className="text-xl font-bold tabular-nums">
                      {formatAmount(
                        preview.amountRequired.amount,
                        inputDecimals,
                      )}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {inputSymbol}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/60">
                    {inputSymbol} (underweight)
                  </div>
                </div>

                {/* Arrow separator */}
                <div className="md:flex hidden items-center justify-center">
                  <div className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-incard">
                    <Equal className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                </div>

                {/* You Receive */}
                <div className="p-3 space-y-1 rounded-lg border border-border bg-incard">
                  <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                    You receive
                  </div>
                  <div className="gap-2 flex items-baseline">
                    <span className="text-xl font-bold tabular-nums">
                      {formatAmount(
                        preview.amountTransferred.amount,
                        outputDecimals,
                      )}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {outputSymbol}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/60">
                    {outputSymbol} (overweight)
                  </div>
                </div>

                {/* Reward */}
                <div className="border-green-500/15 bg-green-500/5 p-3 space-y-1 rounded-lg border">
                  <div className="font-mono font-semibold tracking-wider text-green-600/60 dark:text-green-400/60 text-[10px] uppercase">
                    Reward
                  </div>
                  <div className="gap-2 flex items-center">
                    <TokenIcon
                      token={{
                        address: outputAddress,
                        symbol: outputSymbol,
                      }}
                      size={20}
                      className="shrink-0 rounded-full"
                    />
                    <span className="text-xl font-bold text-green-600 dark:text-green-400 tabular-nums">
                      {formatAmount(
                        preview.liquiditySourceIncentive.amount,
                        outputDecimals,
                      )}
                    </span>
                    <span className="text-sm font-medium text-green-600/60 dark:text-green-400/60">
                      {outputSymbol}
                    </span>
                  </div>
                  <div className="font-mono text-green-600/40 dark:text-green-400/40 text-[10px]">
                    +{incentivePercent.toFixed(2)}% incentive
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Compact summary + CTA */}
            <div className="w-80 md:flex hidden flex-col">
              <div className="p-4 rounded-lg border border-border bg-incard">
                <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                  Quick Summary
                </div>

                <div className="mt-3 border-amber-500/15 bg-amber-500/5 p-3 rounded-lg border">
                  <div className="text-sm font-semibold text-foreground">
                    The pool needs {inputSymbol}.
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Deposit {inputSymbol}. Receive {outputSymbol}.
                  </div>
                  <div className="mt-3 gap-2 font-mono flex flex-wrap text-[10px]">
                    <span className="border-green-500/20 bg-green-500/10 px-2 py-1 text-green-500 rounded-full border">
                      Needs {inputSymbol}
                    </span>
                    <span className="px-2 py-1 rounded-full border border-primary/20 bg-primary/10 text-primary">
                      Extra {outputSymbol}
                    </span>
                  </div>
                </div>

                <div
                  className={`mt-3 gap-2 grid ${activeThreshold > 0 ? "grid-cols-2" : "grid-cols-1"}`}
                >
                  <div className="p-3 rounded-md border border-border/60 bg-background/20">
                    <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                      Deviation
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {currentDeviationLabel}
                    </div>
                  </div>

                  {activeThreshold > 0 && (
                    <div className="border-amber-500/20 bg-amber-500/5 p-3 rounded-md border">
                      <div className="font-mono font-semibold tracking-wider text-amber-600/70 dark:text-amber-400/70 text-[10px] uppercase">
                        Trigger
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                        {activeThreshold.toFixed(1)}% {activeThresholdRelation}{" "}
                        oracle
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-2 gap-2 grid grid-cols-2">
                  <div className="p-3 rounded-md border border-border/60 bg-background/20">
                    <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                      Target
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-foreground">
                      50 / 50 by value
                    </div>
                  </div>
                  <div className="border-green-500/15 bg-green-500/5 p-3 rounded-md border">
                    <div className="font-mono font-semibold tracking-wider text-green-600/70 dark:text-green-400/70 text-[10px] uppercase">
                      Bonus
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-green-600 dark:text-green-400">
                      {bonusLabel}
                    </div>
                  </div>
                </div>

                <div className="mt-3 p-3 rounded-md border border-border/60 bg-background/20">
                  <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                    Rates
                  </div>
                  <div className="mt-2 space-y-1.5 font-mono text-xs text-muted-foreground">
                    {oracleRateLabel && (
                      <div className="gap-3 flex items-start justify-between">
                        <span>Oracle</span>
                        <span className="text-right text-foreground/85">
                          {oracleRateLabel}
                        </span>
                      </div>
                    )}
                    {poolRateLabel && (
                      <div className="gap-3 flex items-start justify-between">
                        <span>Pool</span>
                        <span className="text-right text-foreground/85">
                          {poolRateLabel}
                        </span>
                      </div>
                    )}
                    <div className="gap-3 pt-2 flex items-start justify-between border-t border-border/60">
                      <span>Rebalance rate</span>
                      <span className="text-right text-foreground/85">
                        {expectedRateLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  {!isConnected ? (
                    <p className="text-xs text-center text-muted-foreground">
                      Connect wallet to rebalance
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      className="h-10 w-full"
                      disabled={isBuilding}
                      onClick={handleRebalance}
                    >
                      {isBuilding ? "Preparing..." : "Rebalance"}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile-only CTA */}
            <div className="md:hidden flex justify-end">
              {!isConnected ? (
                <p className="text-xs text-muted-foreground">
                  Connect wallet to rebalance
                </p>
              ) : (
                <Button
                  size="sm"
                  className="h-9 min-w-40"
                  disabled={isBuilding}
                  onClick={handleRebalance}
                >
                  {isBuilding ? "Preparing..." : "Rebalance"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
