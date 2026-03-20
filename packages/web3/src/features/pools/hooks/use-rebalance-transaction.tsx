import { logger } from "@/utils/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type {
  PoolRebalancePreview,
  RebalanceTransaction,
} from "@mento-protocol/mento-sdk";
import { formatUnits, type Address } from "viem";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import { buildPoolRebalanceTransaction } from "../rebalance";
import type { PoolDisplay } from "../types";

const ONE_18 = 10n ** 18n;
const RATIO_PRECISION = 10_000n;
const REBALANCE_SUPPRESSION_MS = 2 * 60_000;

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function formatCompactReserve(amount: bigint, decimalsFactor: bigint): string {
  const decimals = Math.max(0, decimalsFactor.toString().length - 1);
  const value = Number(formatUnits(amount, decimals));

  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) {
    const scaled = value / 1_000_000;
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${trimTrailingZeros(scaled.toFixed(digits))}M`;
  }
  if (value >= 1_000) {
    const scaled = value / 1_000;
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${trimTrailingZeros(scaled.toFixed(digits))}K`;
  }
  if (value >= 1) {
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return trimTrailingZeros(value.toFixed(digits));
  }
  if (value >= 0.01) return trimTrailingZeros(value.toFixed(2));
  return "<0.01";
}

function getOptimisticPoolAfterRebalance(
  pool: PoolDisplay,
  preview: PoolRebalancePreview,
): Pick<PoolDisplay["reserves"], "token0" | "token1" | "token0Ratio"> {
  const token0Address = pool.token0.address.toLowerCase();
  const token1Address = pool.token1.address.toLowerCase();
  const inputToken = preview.inputToken.toLowerCase();
  const outputToken = preview.outputToken.toLowerCase();

  let reserve0 =
    (preview.context.reserves.reserveDen * preview.context.token0Dec) / ONE_18;
  let reserve1 =
    (preview.context.reserves.reserveNum * preview.context.token1Dec) / ONE_18;

  if (inputToken === token0Address) reserve0 += preview.amountRequired.amount;
  if (inputToken === token1Address) reserve1 += preview.amountRequired.amount;

  if (outputToken === token0Address) {
    reserve0 =
      reserve0 > preview.amountTransferred.amount
        ? reserve0 - preview.amountTransferred.amount
        : 0n;
  }
  if (outputToken === token1Address) {
    reserve1 =
      reserve1 > preview.amountTransferred.amount
        ? reserve1 - preview.amountTransferred.amount
        : 0n;
  }

  const normalized0 = (reserve0 * ONE_18) / preview.context.token0Dec;
  const normalized1 = (reserve1 * ONE_18) / preview.context.token1Dec;
  const value0Numerator = normalized0 * preview.context.prices.oracleNum;
  const value1Numerator = normalized1 * preview.context.prices.oracleDen;
  const denominator = value0Numerator + value1Numerator;
  const token0Ratio =
    denominator === 0n
      ? 0
      : Number(
          (value0Numerator * RATIO_PRECISION + denominator / 2n) / denominator,
        ) / Number(RATIO_PRECISION);

  return {
    token0: formatCompactReserve(reserve0, preview.context.token0Dec),
    token1: formatCompactReserve(reserve1, preview.context.token1Dec),
    token0Ratio: Math.max(0, Math.min(1, token0Ratio)),
  };
}

export function useRebalanceTransaction(pool: PoolDisplay) {
  const chainId = pool.chainId;
  const queryClient = useQueryClient();
  const [isBuilding, setIsBuilding] = useState(false);

  const buildTransaction = useCallback(
    async (owner: Address): Promise<RebalanceTransaction> => {
      setIsBuilding(true);
      try {
        return await buildPoolRebalanceTransaction(pool, owner);
      } catch (error) {
        logger.error("Failed to build rebalance transaction:", error);
        throw error;
      } finally {
        setIsBuilding(false);
      }
    },
    [pool],
  );

  const handleSuccess = useCallback(
    async (txHash: string, preview?: PoolRebalancePreview | null) => {
      showLiquiditySuccessToast({
        action: "rebalanced",
        token0Symbol: pool.token0.symbol,
        token1Symbol: pool.token1.symbol,
        txHash,
        chainId,
      });

      // Optimistically clear the rebalance flag so the badge hides immediately.
      // Also keep a short-lived suppression marker so a stale refetch cannot
      // reintroduce the badge while the chain catches up after the transaction.
      queryClient.setQueryData(
        ["recent-pool-rebalance", chainId, pool.poolAddr],
        Date.now() + REBALANCE_SUPPRESSION_MS,
      );

      queryClient.setQueriesData<PoolDisplay[]>(
        { queryKey: ["pools-list", chainId] },
        (old) =>
          old?.map((p) =>
            p.poolAddr === pool.poolAddr
              ? {
                  ...p,
                  reserves: preview
                    ? {
                        ...p.reserves,
                        ...getOptimisticPoolAfterRebalance(p, preview),
                      }
                    : p.reserves,
                  rebalancing: p.rebalancing
                    ? { ...p.rebalancing, canRebalance: false }
                    : undefined,
                }
              : p,
          ),
      );

      // Seed preview as empty so reopened UI does not show stale rebalance data.
      queryClient.removeQueries({
        queryKey: ["pool-rebalance-preview", chainId, pool.poolAddr],
      });

      // Invalidate balance queries immediately
      await queryClient.invalidateQueries({
        predicate: (query) =>
          JSON.stringify(query.queryKey).toLowerCase().includes("balanceof"),
      });
    },
    [
      chainId,
      pool.poolAddr,
      pool.token0.symbol,
      pool.token1.symbol,
      queryClient,
    ],
  );

  return {
    buildTransaction,
    handleSuccess,
    isBuilding,
  };
}
