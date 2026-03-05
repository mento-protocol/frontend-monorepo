import { getMentoSdk } from "@/features/sdk";
import { getTokenByAddress } from "@/config/tokens";
import type { ChainId } from "@/config/chains";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { formatUnits, type Address } from "viem";
import type { PoolDisplay, PriceAlignmentStatus } from "../types";
import { POOL_REFETCH_INTERVAL } from "@/config/constants";

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatCompactWithSuffix(value: number, suffix: "K" | "M"): string {
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${trimTrailingZeros(value.toFixed(decimals))}${suffix}`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000)
    return formatCompactWithSuffix(value / 1_000_000, "M");
  if (value >= 1_000) return formatCompactWithSuffix(value / 1_000, "K");
  if (value >= 1) {
    const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return trimTrailingZeros(value.toFixed(decimals));
  }
  if (value >= 0.01) return trimTrailingZeros(value.toFixed(2));
  return "<0.01";
}

/**
 * Computes token0 share using bigint arithmetic based on token amounts:
 * (reserve0 / scaling0) / ((reserve0 / scaling0) + (reserve1 / scaling1))
 */
function getToken0AmountRatio(
  reserve0: bigint,
  scaling0: bigint,
  reserve1: bigint,
  scaling1: bigint,
): number {
  if (reserve0 <= 0n && reserve1 <= 0n) return 0;

  const numerator = reserve0 * scaling1;
  const denominator = numerator + reserve1 * scaling0;
  if (denominator === 0n) return 0;

  const PRECISION = 10_000n; // 4 decimals for smooth UI bar updates
  const scaledRatio = (numerator * PRECISION + denominator / 2n) / denominator;
  const ratio = Number(scaledRatio) / Number(PRECISION);
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Computes token0 share using value-weighted reserves and pool rate.
 * Assumes priceNum/priceDen represents token1 per token0.
 *
 * value0(token1 units) = (reserve0 / scaling0) * (priceNum / priceDen)
 * value1(token1 units) = (reserve1 / scaling1)
 */
function getToken0ValueRatio(
  reserve0: bigint,
  scaling0: bigint,
  reserve1: bigint,
  scaling1: bigint,
  priceNum: bigint,
  priceDen: bigint,
): number {
  if (reserve0 <= 0n && reserve1 <= 0n) return 0;
  if (priceNum <= 0n || priceDen <= 0n) {
    return getToken0AmountRatio(reserve0, scaling0, reserve1, scaling1);
  }

  const value0Numerator = reserve0 * scaling1 * priceNum;
  const value1Numerator = reserve1 * scaling0 * priceDen;
  const denominator = value0Numerator + value1Numerator;
  if (denominator === 0n) return 0;

  const PRECISION = 10_000n;
  const scaledRatio =
    (value0Numerator * PRECISION + denominator / 2n) / denominator;
  const ratio = Number(scaledRatio) / Number(PRECISION);
  return Math.max(0, Math.min(1, ratio));
}

function getPriceAlignmentStatus(
  inBand: boolean,
  priceDifferencePercent: number,
  thresholdAbovePercent: number,
  thresholdBelowPercent: number,
): PriceAlignmentStatus {
  if (inBand) return "in-band";
  // Out of band: check severity relative to threshold
  // Use the appropriate threshold based on deviation direction
  const relevantThreshold =
    priceDifferencePercent > 0 ? thresholdAbovePercent : thresholdBelowPercent;
  if (Math.abs(priceDifferencePercent) < relevantThreshold * 2)
    return "warning";
  return "rebalance-likely";
}

export function usePoolsList() {
  const chainId = useChainId() as ChainId;

  return useQuery<PoolDisplay[]>({
    queryKey: ["pools-list", chainId],
    queryFn: async () => {
      const sdk = await getMentoSdk(chainId);
      const pools = await sdk.pools.getPools();

      const enrichedPools = await Promise.all(
        pools.map(async (pool) => {
          try {
            const details = await sdk.pools.getPoolDetails(pool.poolAddr);

            const token0Info = getTokenByAddress(
              details.token0 as Address,
              chainId,
            );
            const token1Info = getTokenByAddress(
              details.token1 as Address,
              chainId,
            );

            if (!token0Info || !token1Info) {
              console.warn(
                `[usePoolsList] Token not found for pool ${pool.poolAddr}: token0=${details.token0} (${!!token0Info}), token1=${details.token1} (${!!token1Info})`,
              );
              return null;
            }

            const reserve0Value = Number(
              formatUnits(details.reserve0, token0Info.decimals),
            );
            const reserve1Value = Number(
              formatUnits(details.reserve1, token1Info.decimals),
            );
            const reserve0Formatted = formatCompactNumber(reserve0Value);
            const reserve1Formatted = formatCompactNumber(reserve1Value);
            const hasLiquidity = details.reserve0 > 0n || details.reserve1 > 0n;

            let fees: PoolDisplay["fees"];
            let priceAlignment: PoolDisplay["priceAlignment"];
            let pricing: PoolDisplay["pricing"];
            let rebalancing: PoolDisplay["rebalancing"];

            if (details.poolType === "FPMM") {
              fees = {
                total: details.fees.totalFeePercent,
                lp: details.fees.lpFeePercent,
                protocol: details.fees.protocolFeePercent,
                label: "fee",
              };
              if (
                details.pricing &&
                details.rebalancing &&
                details.rebalancing.inBand !== null
              ) {
                priceAlignment = {
                  status: getPriceAlignmentStatus(
                    details.rebalancing.inBand,
                    details.pricing.priceDifferencePercent,
                    details.rebalancing.rebalanceThresholdAbovePercent,
                    details.rebalancing.rebalanceThresholdBelowPercent,
                  ),
                  priceDifferencePercent:
                    details.pricing.priceDifferencePercent,
                };

                // Add pricing details for FPMM pools
                pricing = {
                  oraclePrice: details.pricing.oraclePrice,
                  poolPrice: details.pricing.reservePrice,
                  deviationBps: Number(details.pricing.priceDifferenceBps),
                  isPoolPriceAbove:
                    details.pricing.reservePriceAboveOraclePrice,
                };

                // Add rebalancing details
                rebalancing = {
                  incentivePercent:
                    details.rebalancing.rebalanceIncentivePercent,
                  thresholdAboveBps: Number(
                    details.rebalancing.rebalanceThresholdAboveBps,
                  ),
                  thresholdBelowBps: Number(
                    details.rebalancing.rebalanceThresholdBelowBps,
                  ),
                  canRebalance:
                    !details.rebalancing.inBand &&
                    !!details.rebalancing.liquidityStrategy,
                  liquidityStrategy: details.rebalancing.liquidityStrategy,
                };
              } else {
                priceAlignment = { status: "market-closed" };
              }
            } else {
              fees = {
                total: details.spreadPercent,
                lp: 0,
                protocol: details.spreadPercent,
                label: "spread",
              };
              priceAlignment = { status: "none" };
            }

            const token0Ratio =
              details.poolType === "FPMM" && details.pricing
                ? getToken0ValueRatio(
                    details.reserve0,
                    details.scalingFactor0,
                    details.reserve1,
                    details.scalingFactor1,
                    details.pricing.oraclePriceNum,
                    details.pricing.oraclePriceDen,
                  )
                : getToken0AmountRatio(
                    details.reserve0,
                    details.scalingFactor0,
                    details.reserve1,
                    details.scalingFactor1,
                  );

            const poolDisplay: PoolDisplay = {
              poolAddr: pool.poolAddr,
              poolType: details.poolType === "FPMM" ? "FPMM" : "Legacy",
              token0: {
                symbol: token0Info.symbol,
                address: details.token0,
                decimals: token0Info.decimals,
                name: token0Info.name,
              },
              token1: {
                symbol: token1Info.symbol,
                address: details.token1,
                decimals: token1Info.decimals,
                name: token1Info.name,
              },
              reserves: {
                token0: reserve0Formatted,
                token1: reserve1Formatted,
                token0Ratio,
                hasLiquidity,
              },
              fees,
              priceAlignment,
              ...(pricing && { pricing }),
              ...(rebalancing && { rebalancing }),
            };

            return poolDisplay;
          } catch (error) {
            console.error(
              `[usePoolsList] Failed to enrich pool ${pool.poolAddr}:`,
              error,
            );
            return null;
          }
        }),
      );

      return enrichedPools.filter((p): p is PoolDisplay => p !== null);
    },
    staleTime: POOL_REFETCH_INTERVAL,
    refetchInterval: POOL_REFETCH_INTERVAL,
    gcTime: 5 * 60_000,
  });
}
