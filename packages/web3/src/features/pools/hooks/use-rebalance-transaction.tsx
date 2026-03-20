import { logger } from "@/utils/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { RebalanceTransaction } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import { buildPoolRebalanceTransaction } from "../rebalance";
import type { PoolDisplay } from "../types";

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
    async (txHash: string) => {
      showLiquiditySuccessToast({
        action: "rebalanced",
        token0Symbol: pool.token0.symbol,
        token1Symbol: pool.token1.symbol,
        txHash,
        chainId,
      });

      // Optimistically clear the rebalance flag so the badge hides immediately.
      // Don't invalidate pools-list right away — the RPC may still return stale
      // data and overwrite this optimistic update. The regular polling interval
      // will pick up the new state once it has propagated.
      queryClient.setQueriesData<PoolDisplay[]>(
        { queryKey: ["pools-list", chainId] },
        (old) =>
          old?.map((p) =>
            p.poolAddr === pool.poolAddr
              ? {
                  ...p,
                  rebalancing: p.rebalancing
                    ? { ...p.rebalancing, canRebalance: false }
                    : undefined,
                }
              : p,
          ),
      );

      // Invalidate the preview cache so the panel doesn't show stale data
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
