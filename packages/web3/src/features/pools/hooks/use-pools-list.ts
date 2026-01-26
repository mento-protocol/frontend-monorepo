import { getMentoSdk } from "@/features/sdk";
import { getTokenByAddress } from "@/config/tokens";
import type { ChainId } from "@/config/chains";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import type { Address } from "viem";
import type { PoolDisplay, PriceAlignmentStatus } from "../types";
import { POOL_REFETCH_INTERVAL } from "@/config/constants";

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (value >= 1) return value.toFixed(0);
  return value.toFixed(2);
}

function getPriceAlignmentStatus(
  inBand: boolean,
  priceDifferencePercent: number,
  thresholdAbovePercent: number,
): PriceAlignmentStatus {
  if (inBand) return "in-band";
  // Out of band: check severity relative to threshold
  if (Math.abs(priceDifferencePercent) < thresholdAbovePercent * 2)
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

            const reserve0Value =
              Number(details.reserve0) / Number(details.decimals0);
            const reserve1Value =
              Number(details.reserve1) / Number(details.decimals1);
            const reserve0Formatted = formatCompactNumber(reserve0Value);
            const reserve1Formatted = formatCompactNumber(reserve1Value);
            const totalReserves = reserve0Value + reserve1Value;
            const token0Ratio =
              totalReserves > 0 ? reserve0Value / totalReserves : 0.5;

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
