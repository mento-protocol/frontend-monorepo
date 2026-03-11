import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { RebalanceTransaction } from "@mento-protocol/mento-sdk";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import type { PoolDisplay } from "../types";

export function useRebalanceTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const queryClient = useQueryClient();
  const [isBuilding, setIsBuilding] = useState(false);

  const buildTransaction = useCallback(
    async (owner: Address): Promise<RebalanceTransaction> => {
      setIsBuilding(true);
      try {
        const sdk = await getMentoSdk(chainId);
        return await sdk.liquidity.buildRebalanceTransaction({
          poolAddress: pool.poolAddr as Address,
          owner,
        });
      } catch (error) {
        logger.error("Failed to build rebalance transaction:", error);
        throw error;
      } finally {
        setIsBuilding(false);
      }
    },
    [chainId, pool.poolAddr],
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

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["pools-list", chainId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["pool-rebalance-preview", chainId, pool.poolAddr],
        }),
        queryClient.invalidateQueries({
          predicate: (query) =>
            JSON.stringify(query.queryKey).toLowerCase().includes("balanceof"),
        }),
      ]);
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
