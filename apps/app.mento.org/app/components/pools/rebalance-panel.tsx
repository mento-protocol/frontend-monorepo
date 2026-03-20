"use client";

import { useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";

import { Button, TokenIcon } from "@repo/ui";
import {
  chainIdToChain,
  type ChainId,
  type PoolDisplay,
  usePoolRebalancePreview,
  useRebalanceTransaction,
  executeLiquidityFlow,
  liquidityFlowAtom,
  type LiquidityFlowStepDefinition,
} from "@repo/web3";
import {
  useAccount,
  useChainId,
  useConfig,
  useSwitchChain,
} from "@repo/web3/wagmi";
import { formatUnits, type Address } from "viem";
import { toast } from "sonner";

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

function resolveTokenDecimals(tokenAddress: string, pool: PoolDisplay): number {
  return tokenAddress.toLowerCase() === pool.token0.address.toLowerCase()
    ? pool.token0.decimals
    : pool.token1.decimals;
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

function formatCooldownDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  return `${secs}s`;
}

const COOLDOWN_SAFETY_BUFFER_SECONDS = 2;

interface RebalancePanelProps {
  pool: PoolDisplay;
  onRebalanceComplete?: () => void;
}

export function RebalancePanel({
  pool,
  onRebalanceComplete,
}: RebalancePanelProps) {
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useConfig();
  const setFlow = useSetAtom(liquidityFlowAtom);
  const {
    data: fullPreview,
    isLoading: isFullPreviewLoading,
    isError: isFullPreviewError,
  } = usePoolRebalancePreview(pool, true);
  const hasConnectedWallet = isConnected && !!address;
  const {
    data: walletPreview,
    isLoading: isWalletPreviewLoading,
    isError: isWalletPreviewError,
  } = usePoolRebalancePreview(
    pool,
    hasConnectedWallet,
    address as Address | undefined,
  );
  const { buildTransaction, handleSuccess, isBuilding } =
    useRebalanceTransaction(pool);
  const targetChain = chainIdToChain[pool.chainId as ChainId];
  const targetChainName = targetChain?.name ?? `Chain ${pool.chainId}`;
  const isWrongChain = isConnected && walletChainId !== pool.chainId;
  const preview = hasConnectedWallet
    ? (walletPreview ?? fullPreview)
    : fullPreview;
  const executionPreview = hasConnectedWallet ? walletPreview : null;
  const cooldownEndsAt =
    preview?.config.lastRebalance && preview.config.rebalanceCooldown > 0
      ? preview.config.lastRebalance +
        preview.config.rebalanceCooldown +
        COOLDOWN_SAFETY_BUFFER_SECONDS
      : 0;
  const cooldownRemainingSeconds =
    cooldownEndsAt > 0 ? Math.max(0, cooldownEndsAt - nowTs) : 0;
  const isOnCooldown = cooldownRemainingSeconds > 0;

  useEffect(() => {
    setNowTs(Math.floor(Date.now() / 1000));
  }, [preview?.config.lastRebalance, preview?.config.rebalanceCooldown]);

  useEffect(() => {
    if (!isOnCooldown) return;

    const intervalId = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isOnCooldown]);

  const handleRebalance = async () => {
    if (!address || !executionPreview || isWrongChain) return;
    if (isOnCooldown) {
      toast.error(
        `Rebalance cooldown active. Try again in ${formatCooldownDuration(
          cooldownRemainingSeconds,
        )}.`,
      );
      return;
    }

    try {
      const tx = await buildTransaction(address as Address);

      const steps: LiquidityFlowStepDefinition[] = [];

      if (tx.approval) {
        steps.push({
          id: "approve",
          label: `Approve ${resolveTokenSymbol(executionPreview.inputToken, pool)}`,
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
        await handleSuccess(
          result.txHashes[result.txHashes.length - 1]!,
          executionPreview,
        );
        onRebalanceComplete?.();
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to prepare rebalance. Please try again.";

      // Avoid duplicating wallet rejection toasts if the flow already surfaced one.
      if (
        !/user rejected|request rejected|denied transaction signature/i.test(
          message,
        )
      ) {
        toast.error(message);
      }
    }
  };

  const handleSwitchChain = async () => {
    try {
      if (!switchChainAsync) throw new Error("switchChainAsync unavailable");
      await switchChainAsync({ chainId: pool.chainId });
    } catch {
      toast.error(
        `Could not switch to ${targetChainName}. Please switch networks in your wallet.`,
      );
    }
  };

  if (
    (isFullPreviewLoading && !fullPreview) ||
    (hasConnectedWallet && isWalletPreviewLoading && !walletPreview)
  ) {
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

  if (
    isFullPreviewError ||
    (!preview && (!hasConnectedWallet || isWalletPreviewError))
  ) {
    return (
      <div className="px-4 py-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          {isFullPreviewError || isWalletPreviewError
            ? "Failed to load rebalance data. Please try again."
            : "No rebalance data available for this pool."}
        </p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="px-4 py-4 border-t border-border">
        <p className="text-sm text-muted-foreground">
          No rebalance data available for this pool.
        </p>
      </div>
    );
  }

  const inputSymbol = resolveTokenSymbol(preview.inputToken, pool);
  const outputSymbol = resolveTokenSymbol(preview.outputToken, pool);
  const inputAddress = resolveTokenAddress(preview.inputToken, pool);
  const outputAddress = resolveTokenAddress(preview.outputToken, pool);

  const inputDecimals = resolveTokenDecimals(inputAddress, pool);
  const outputDecimals = resolveTokenDecimals(outputAddress, pool);

  const formattedDepositAmount = formatAmount(
    preview.amountRequired.amount,
    inputDecimals,
  );
  const formattedReceiveAmount = formatAmount(
    preview.amountTransferred.amount,
    outputDecimals,
  );
  const formattedBonusAmount = formatAmount(
    preview.liquiditySourceIncentive.amount,
    outputDecimals,
  );
  const hasWalletScopedPreview = hasConnectedWallet && !!walletPreview;
  const isWalletLimited =
    !!fullPreview &&
    !!walletPreview &&
    walletPreview.inputToken.toLowerCase() ===
      fullPreview.inputToken.toLowerCase() &&
    walletPreview.amountRequired.amount < fullPreview.amountRequired.amount;
  const isWalletIneligible =
    hasConnectedWallet && !walletPreview && !!fullPreview;
  const fullInputSymbol = fullPreview
    ? resolveTokenSymbol(fullPreview.inputToken, pool)
    : inputSymbol;
  const fullInputAddress = fullPreview
    ? resolveTokenAddress(fullPreview.inputToken, pool)
    : inputAddress;
  const fullInputDecimals = resolveTokenDecimals(fullInputAddress, pool);
  const formattedFullRequiredAmount = fullPreview
    ? formatAmount(fullPreview.amountRequired.amount, fullInputDecimals)
    : formattedDepositAmount;

  const token0Ratio = Math.max(0, Math.min(1, pool.reserves.token0Ratio));
  const token0Percent = Math.round(token0Ratio * 100);
  const token1Percent = 100 - token0Percent;

  const incentivePercent = pool.rebalancing?.incentivePercent ?? 0;
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
  const cooldownLabel = isOnCooldown
    ? `Cooldown: ${formatCooldownDuration(cooldownRemainingSeconds)}`
    : null;
  const buttonLabel = isBuilding
    ? "Preparing..."
    : isWalletIneligible
      ? `Need ${inputSymbol} to rebalance`
      : (cooldownLabel ?? "Rebalance");

  return (
    <div className="px-4 pb-4 pt-4 border-t border-border">
      <div className="border-amber-500/10 bg-amber-500/5 overflow-hidden rounded-lg border">
        <div className="space-y-4 p-4 md:p-5">
          {/* Header */}
          <div className="gap-2 flex items-center">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-semibold">
              This pool is out of balance.
            </span>
          </div>

          <div className="space-y-4">
            {/* Description */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              This pool has drifted away from its target reserve mix.
              Rebalancing helps move it back toward balance by adding the
              scarcer asset and removing the excess asset, with a bonus for
              doing so. Read the docs to{" "}
              <a
                href="https://docs.mento.org/mento-v3/dive-deeper/fpmm/rebalancing-and-strategies"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary"
              >
                learn more
              </a>
              .
            </p>

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
                .
              </p>

              <div className="gap-x-4 gap-y-1 font-mono flex flex-wrap items-center text-[10px] text-muted-foreground/80">
                <span className="gap-1.5 inline-flex items-center">
                  <span className="h-3 w-0.5 rounded-full bg-foreground/70 shadow-[0_0_4px_rgba(255,255,255,0.3)]" />
                  - Target 50/50
                </span>
                {activeThreshold > 0 && (
                  <span className="gap-1.5 text-amber-600 dark:text-amber-400 inline-flex items-center">
                    <span className="h-3 w-px border-l border-dashed border-current" />
                    - Rebalance trigger ({activeThreshold.toFixed(1)}%{" "}
                    {activeThresholdRelation} oracle)
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
            </div>

            {/* Preview */}
            <div className="mt-1 gap-1.5 flex flex-col">
              <div className="text-xs font-mono font-semibold tracking-wider text-muted-foreground uppercase">
                Preview
              </div>
              {isWalletLimited ? (
                <p className="text-[11px] text-muted-foreground">
                  Pool needs{" "}
                  <span className="font-semibold text-foreground">
                    {formattedFullRequiredAmount} {fullInputSymbol}
                  </span>{" "}
                  to fully rebalance. With your current wallet, you can provide{" "}
                  <span className="font-semibold text-foreground">
                    {formattedDepositAmount} {inputSymbol}
                  </span>
                  .
                </p>
              ) : isWalletIneligible ? (
                <p className="text-[11px] text-muted-foreground">
                  Pool needs{" "}
                  <span className="font-semibold text-foreground">
                    {formattedFullRequiredAmount} {fullInputSymbol}
                  </span>{" "}
                  to fully rebalance. Your current wallet cannot contribute to
                  this rebalance yet.
                </p>
              ) : null}
            </div>
            <div className="gap-3 md:grid-cols-3 grid grid-cols-1 items-stretch">
              {/* Deposit */}
              <div className="p-3 space-y-1 rounded-lg border border-border bg-incard">
                <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                  {hasWalletScopedPreview ? "You deposit" : "Required deposit"}
                </div>
                <div className="gap-2 flex items-center">
                  <TokenIcon
                    token={{
                      address: inputAddress,
                      symbol: inputSymbol,
                    }}
                    size={20}
                    className="shrink-0 rounded-full"
                  />
                  <div className="gap-2 flex items-baseline">
                    <span className="text-xl font-bold tabular-nums">
                      {formattedDepositAmount}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {inputSymbol}
                    </span>
                  </div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground/60">
                  {hasWalletScopedPreview
                    ? isWalletLimited
                      ? "From your current wallet balance"
                      : "From your wallet"
                    : "Pool needs this to rebalance"}
                </div>
              </div>

              {/* Receive */}
              <div className="p-3 space-y-1 rounded-lg border border-border bg-incard">
                <div className="font-mono font-semibold tracking-wider text-[10px] text-muted-foreground uppercase">
                  {hasWalletScopedPreview ? "You receive" : "Expected receive"}
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
                  <div className="gap-2 flex items-baseline">
                    <span className="text-xl font-bold tabular-nums">
                      {formattedReceiveAmount}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      {outputSymbol}
                    </span>
                  </div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground/60">
                  {hasWalletScopedPreview
                    ? "Expected from your current rebalance"
                    : "Expected if this rebalance is executed now"}
                </div>
              </div>

              {/* Bonus */}
              <div className="border-green-500/15 bg-green-500/5 p-3 space-y-1 rounded-lg border">
                <div className="font-mono font-semibold tracking-wider text-green-600/60 dark:text-green-400/60 text-[10px] uppercase">
                  Bonus
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
                    {formattedBonusAmount}
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

            <div className="flex">
              {!isConnected ? (
                <Button
                  size="sm"
                  className="h-10 md:w-auto md:min-w-52 w-full whitespace-nowrap"
                  disabled={true}
                  onClick={() => {}}
                >
                  Connect wallet to rebalance
                </Button>
              ) : isWrongChain ? (
                <Button
                  size="sm"
                  className="h-10 md:w-auto md:min-w-44 gap-2 w-full"
                  onClick={handleSwitchChain}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Switch to {targetChainName}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-10 md:w-auto md:min-w-52 w-full whitespace-nowrap"
                  disabled={isBuilding || isOnCooldown || isWalletIneligible}
                  onClick={handleRebalance}
                >
                  {buttonLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
