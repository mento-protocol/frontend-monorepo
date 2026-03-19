import { POOL_REFETCH_INTERVAL } from "@/config/constants";
import type { PoolRebalancePreview } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { getPoolRebalancePreview } from "../rebalance";
import type { PoolDisplay } from "../types";

export function usePoolRebalancePreview(pool: PoolDisplay, enabled = true) {
  const chainId = pool.chainId;

  return useQuery<PoolRebalancePreview | null>({
    queryKey: ["pool-rebalance-preview", chainId, pool.poolAddr],
    queryFn: async () => getPoolRebalancePreview(pool),
    enabled:
      enabled &&
      pool.poolType === "FPMM" &&
      !!pool.rebalancing?.liquidityStrategy,
    refetchInterval: POOL_REFETCH_INTERVAL,
    staleTime: POOL_REFETCH_INTERVAL,
  });
}
