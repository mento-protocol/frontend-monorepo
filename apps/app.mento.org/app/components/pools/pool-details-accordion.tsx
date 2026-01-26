"use client";

import { Badge, Button } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useTriggerRebalance } from "./use-trigger-rebalance";

interface PoolDetailsAccordionProps {
  pool: PoolDisplay;
}

export function PoolDetailsAccordion({ pool }: PoolDetailsAccordionProps) {
  const { triggerRebalance, isPending } = useTriggerRebalance();

  // Handle Legacy pools differently
  if (pool.poolType === "Legacy") {
    return (
      <div className="px-6 py-5 border-t border-border bg-muted/60">
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is a legacy pool using the virtual AMM model. It will be migrated
          to FPMM in the future. Migration target: {pool.token0.symbol} /{" "}
          {pool.token1.symbol} (FPMM)
        </p>
      </div>
    );
  }

  // Only show for FPMM pools with pricing data
  if (pool.poolType !== "FPMM" || !pool.pricing || !pool.rebalancing) {
    return null;
  }

  const handleRebalance = () => {
    if (pool.rebalancing?.liquidityStrategy) {
      triggerRebalance({
        strategyAddress: pool.rebalancing.liquidityStrategy,
        poolAddress: pool.poolAddr,
      });
    }
  };

  const formatPrice = (price: number, pair: string) => {
    // Adaptive precision based on price magnitude
    let decimals: number;
    if (price < 0.001) {
      decimals = 8; // Very small: 0.00000123
    } else if (price < 0.01) {
      decimals = 6; // Small: 0.001234
    } else if (price < 1) {
      decimals = 5; // Medium-small: 0.12345
    } else {
      decimals = 4; // Normal/large: 1.2345
    }

    return `${price.toFixed(decimals)} ${pair}`;
  };

  return (
    <div className="px-6 py-5 space-y-6 border-t border-border bg-muted/60">
      {/* Two column layout */}
      <div className="gap-8 grid grid-cols-2">
        {/* Left column: Pricing & Oracle */}
        <div>
          <h3 className="text-base font-semibold mb-4">Pricing & Oracle</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Oracle Price:
              </span>
              <span className="text-sm">
                {formatPrice(
                  pool.pricing.oraclePrice,
                  `${pool.token1.symbol} / ${pool.token0.symbol}`,
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Pool Price:</span>
              <span className="text-sm">
                {formatPrice(
                  pool.pricing.poolPrice,
                  `${pool.token1.symbol} / ${pool.token0.symbol}`,
                )}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Deviation:</span>
              <div className="gap-2 flex items-center">
                <span className="text-sm">
                  {pool.pricing.deviationBps > 0 ? "+" : ""}
                  {pool.pricing.deviationBps} bps
                </span>
                {pool.priceAlignment.status === "in-band" && (
                  <Badge className="border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
                    In band
                  </Badge>
                )}
              </div>
            </div>

            <div className="pt-2 text-xs text-muted-foreground">
              {pool.pricing.isPoolPriceAbove
                ? "Pool price above oracle"
                : "Pool price below oracle"}
            </div>
          </div>
        </div>

        {/* Right column: Rebalancing */}
        <div>
          <h3 className="text-base font-semibold mb-4">Rebalancing</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Rebalance incentive:
              </span>
              <span className="text-sm font-semibold text-primary">
                {pool.rebalancing.incentivePercent.toFixed(2)}%
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Thresholds:</span>
              <span className="text-sm">
                +{pool.rebalancing.thresholdAboveBps} bps / -
                {pool.rebalancing.thresholdBelowBps} bps
              </span>
            </div>

            <div className="pt-3">
              <Button
                onClick={handleRebalance}
                disabled={!pool.rebalancing.canRebalance || isPending}
                className="w-full"
              >
                {isPending ? "Triggering..." : "Trigger rebalance"}
              </Button>
              {pool.rebalancing.canRebalance && (
                <p className="text-xs mt-2 text-muted-foreground">
                  This is a public maintenance action to restore the pool toward
                  the oracle price. Incentivized strategies usually rebalance
                  automatically.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
