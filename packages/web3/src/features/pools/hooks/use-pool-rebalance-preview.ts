import { POOL_REFETCH_INTERVAL } from "@/config/constants";
import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import type { PoolRebalancePreview } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import type { PoolDisplay } from "../types";

export function usePoolRebalancePreview(pool: PoolDisplay, enabled = true) {
  const chainId = useChainId() as ChainId;

  return useQuery<PoolRebalancePreview | null>({
    queryKey: ["pool-rebalance-preview", chainId, pool.poolAddr],
    queryFn: async () => {
      const sdk = await getMentoSdk(chainId);
      return sdk.pools.getPoolRebalancePreview(pool.poolAddr);
    },
    enabled:
      enabled &&
      pool.poolType === "FPMM" &&
      !!pool.rebalancing?.liquidityStrategy,
    refetchInterval: POOL_REFETCH_INTERVAL,
    staleTime: POOL_REFETCH_INTERVAL,
  });
}
